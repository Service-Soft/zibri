import { Readable } from 'node:stream';

import type { Batch, GlideClient, GlideClientConfiguration, GlideString, PubSubMsg, Script } from '@valkey/valkey-glide';

import { valKeyGlide } from './val-key-glide.function';
import { type AuthServiceInterface } from '../../../auth/auth-service.interface';
import { ChangeSetRepository } from '../../../change-sets/change-set-repository';
import { ChangeSetEntity } from '../../../change-sets/models/change-set-entity.model';
import { ChangeSet } from '../../../change-sets/models/change-set.model';
import { isChangeSetEntityNewable } from '../../../change-sets/models/is-change-set-entity.function';
import { isSoftDeleteEntityNewable } from '../../../change-sets/models/is-soft-delete-entity.function';
import { SoftDeleteEntity } from '../../../change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../../../change-sets/soft-delete-repository';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { EntityMetadata } from '../../../entity/decorators/entity.decorator';
import { PropertyMetadata, PropertyMetadataInput, RelationMetadata } from '../../../entity/decorators/property.decorator';
import { EntityMetadataMissingError } from '../../../entity/entity-metadata-missing.error';
import { FilePropertyMetadata } from '../../../entity/models/file-property-metadata.model';
import { InternalError } from '../../../error-handling/internal-error.model';
import { HeldLease } from '../../../leases/held-lease.model';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { ExcludeStrict } from '../../../types/exclude-strict.type';
import { Newable } from '../../../types/newable.type';
import { OmitStrict } from '../../../types/omit-strict.type';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../../utilities/object.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { SemVerVersion } from '../../../versioning/sem-ver.utilities';
import { RepositoryDriverInterface } from '../../driver/repository-driver.interface';
import { ValKeyRepositoryDriver } from '../../driver/val-key.repository-driver';
import { registerRepositoryProvidersFor } from '../../entity-ownership.function';
import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook } from '../../hooks/hooks.default';
import { Migration } from '../../migration/migration.model';
import { revertMigrationsAfter, runMigrations } from '../../migration/run-migrations.function';
import { Repository } from '../../repository/repository';
import { Transaction } from '../../transaction/transaction.model';
import { ValKeyTransaction } from '../../transaction/val-key-transaction.model';
import { DataSourceInitializationError } from '../data-source-initialization.error';
import { DataSourceInterface, RepositoryTypeForEntity, SCHEMA_LOCK_KEY, StartTransactionOptions } from '../data-source.interface';
import { DataSourceSubscription, PubSubDataSourceInterface } from '../pub-sub-data-source.interface';

/**
 * ValKey-specific connection options.
 */
export type ValKeyOptions = OmitStrict<GlideClientConfiguration, 'addresses'> & {
    /**
     * The host of the valkey server.
     * @default 'localhost'
     */
    host?: string,
    /**
     * The port of the valkey server.
     * @default 6379
     */
    port?: number,
    /**
     * The prefix that all keys of this data source are stored under.
     *
     * This is what keeps multiple data sources (or multiple apps) on the same server apart,
     * it is also the only thing that is dropped when a backup is restored.
     * @default 'zibri'
     */
    keyPrefix?: string
};

/**
 * A single entry of a valkey backup.
 */
type ValKeyBackupEntry = {
    /**
     * The key of the dumped value.
     */
    key: string,
    /**
     * The remaining time to live in milliseconds, 0 when the key does not expire.
     */
    ttlMs: number,
    /**
     * The base64 encoded payload as produced by the DUMP command.
     */
    payload: string
};

/**
 * The result for updating stored rows.
 */
type UpdateStoredRowsResult = {
    /**
     * The updated values.
     */
    values: Record<string, string>,
    /**
     * Keys to remove, if any.
     */
    remove?: string[]
};

/**
 * Namespace for lock keys, so a lock can never collide with a stored entity.
 */
const LOCK_KEY_PREFIX: string = 'zibri.lock:';

/**
 * Namespace a backup is restored into before it is swapped in.
 *
 * A whole segment of the key rather than a suffix, so it cannot collide with an entity: a table name
 * containing a colon is not addressable in the first place.
 */
const RESTORE_STAGING_SEGMENT: string = 'zibri.restore';

/**
 * How long to wait between attempts at taking a lock, in milliseconds.
 */
const LOCK_RETRY_IN_MS: number = 100;

/**
 * How long a transaction may sit idle before it is rolled back, when it does not say for itself.
 *
 * Valkey has no server side equivalent of postgres' idle_in_transaction_session_timeout, so the
 * bound is kept here. What sets the floor is the longest gap between two writes of one transaction:
 * the save hooks run in that gap and hashing and encryption are the slow part of them, where an
 * ordinary gap is a few hundred milliseconds at most. A transaction that knows it will wait longer
 * between two of its writes says so when it starts.
 */
const DEFAULT_TRANSACTION_IDLE_TIMEOUT_IN_MS: number = 10000;

/**
 * The two lua scripts a lock needs, each once it has been built.
 */
type LockScripts = {
    /**
     * Frees a lock this caller still holds.
     */
    release?: Script,
    /**
     * Extends a lock this caller still holds.
     */
    renew?: Script
};

/**
 * The scripts, once they have been built.
 *
 * Built on first use rather than at module scope, because constructing one needs the optional valkey
 * client and doing that while this file loads would make every application need that package - the
 * barrel re-exports this module, so a postgres-only application reaches it too. Kept afterwards
 * because a `Script` is hashed once and invoked by that hash from then on.
 */
const lockScripts: LockScripts = {};

/**
 * Frees the lock, but only when it is still the one this caller took.
 *
 * `del` on its own cannot express that. Without the check, a holder whose lease had already expired
 * would delete whatever key now sits there - which is somebody else's lock - and every later caller
 * would then be releasing the lock of the one before it.
 * @returns The script.
 */
function releaseLockScript(): Script {
    lockScripts.release ??= new (valKeyGlide().Script)(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end'
    );
    return lockScripts.release;
}

/**
 * Pushes the expiry out, but only while the lock is still this caller's.
 *
 * Returning 0 means it is not, and no amount of extending would make it so again.
 * @returns The script.
 */
function renewLockScript(): Script {
    lockScripts.renew ??= new (valKeyGlide().Script)(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end'
    );
    return lockScripts.renew;
}

/**
 * A base valkey data source definition.
 *
 * Entities are stored as hashes, all ids of an entity are kept in a set next to them so that finding
 * entities does not need to scan the keyspace. Because valkey cannot filter hashes server side, where
 * filters are applied in process after loading the entities of the queried entity type.
 *
 * ## Differences to a sql data source
 * - Transactions are atomic, but not isolated: valkey applies the buffered commands in one batch on
 * commit, it does not lock anything while the transaction is open.
 * - There is no schema, so migrations only rewrite the values that are already stored.
 */
export abstract class ValKeyDataSource implements DataSourceInterface, PubSubDataSourceInterface {

    abstract readonly entities: Newable<BaseEntity>[];

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly migrations: Newable<Migration>[] = [];

    /**
     * The configuration options of the data source.
     */
    readonly options: ValKeyOptions = {};

    /**
     * The default configuration options of the data source.
     */
    protected readonly defaultOptions: ValKeyOptions = {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'zibri',
        requestTimeout: 5000
    };

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Combination of the default and user provided options.
     */
    protected get fullOptions(): ValKeyOptions {
        return {
            ...this.defaultOptions,
            ...this.options
        };
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The prefix that all keys of this data source are stored under.
     */
    get keyPrefix(): string {
        return this.fullOptions.keyPrefix ?? 'zibri';
    }

    /**
     * The client that is connected to the valkey server.
     */
    protected client?: GlideClient;

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The client that is connected to the valkey server.
     *
     * Used by everything that shares the connection of this data source, eg. The ValKeyCacheStore.
     * @throws When the data source has not been initialized yet.
     */
    get connection(): GlideClient {
        if (!this.client) {
            throw new DataSourceInitializationError();
        }
        return this.client;
    }

    private readonly repositories: Map<Newable<BaseEntity>, Repository<BaseEntity>> = new Map();

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        protected readonly authService: AuthServiceInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async init(): Promise<void> {
        if (this.client) {
            throw new InternalError('The data source has already been initialized.');
        }

        // eslint-disable-next-line unusedImports/no-unused-vars
        const { host, port, keyPrefix, ...clientOptions } = this.fullOptions;
        await this.validateOptions(this.fullOptions);

        for (const entityClass of this.entities) {
            this.validateEntity(entityClass);
        }
        registerRepositoryProvidersFor(this.constructor as Newable<DataSourceInterface>, this);

        this.client = await valKeyGlide().GlideClient.createClient({
            ...clientOptions,
            addresses: [{ host: host ?? 'localhost', port: port ?? 6379 }]
        });

        // migrations rewrite stored values, so several instances running them together is the same
        // race a sql data source has with its schema, minus the ddl
        await this.schemaLock(SCHEMA_LOCK_KEY, async () => {
            await this.runMigrations();
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async publish(channel: string, message: string): Promise<void> {
        if (!this.client) {
            throw new DataSourceInitializationError();
        }
        await this.client.publish(message, `${this.keyPrefix}:${channel}`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async subscribe(channel: string, onMessage: (message: string) => void): Promise<DataSourceSubscription> {
        // eslint-disable-next-line unusedImports/no-unused-vars
        const { host, port, keyPrefix, ...clientOptions } = this.fullOptions;

        // its own client: a connection that is subscribed is not a connection that should also be
        // answering commands, and the data source's one is busy doing exactly that
        const subscriber: GlideClient = await valKeyGlide().GlideClient.createClient({
            ...clientOptions,
            addresses: [{ host: host ?? 'localhost', port: port ?? 6379 }]
        });
        await subscriber.subscribeLazy([`${this.keyPrefix}:${channel}`]);

        let listening: boolean = true;

        // glide hands messages over by resolving a promise rather than by calling back, so reading
        // them is a loop that parks until the next one arrives
        const listen: () => Promise<void> = async () => {
            while (listening) {
                try {
                    const msg: PubSubMsg = await subscriber.getPubSubMessage();
                    if (listening) {
                        onMessage(msg.message.toString());
                    }
                }
                catch (error) {
                    if (listening) {
                        this.logger.error(new InternalError('a subscription to valkey failed', { cause: error }));
                    }
                    return;
                }
            }
        };
        void listen();

        return {
            unsubscribe: async () => {
                listening = false;
                subscriber.close();
                await Promise.resolve();
            }
        };
    }

    /**
     * Pushes the lock's expiry out while the work is still running.
     *
     * Losing it is reported rather than acted on. Cancelling the work half way would leave whatever
     * it had already written behind, which is not obviously better than finishing - and the release
     * checks the token anyway, so a lapsed holder cannot take somebody else's lock away on its way
     * out. What must not happen is losing it silently.
     * @param client - The client holding the lock.
     * @param lockKey - The namespaced key the lock lives under.
     * @param token - The token this caller took the lock with.
     * @param holdInMs - How much longer the lock should live.
     * @param key - The unprefixed key, for the log message.
     */
    private async renewLock(
        client: GlideClient,
        lockKey: string,
        token: string,
        holdInMs: number,
        key: string
    ): Promise<void> {
        try {
            const renewed: unknown = await client.invokeScript(
                renewLockScript(),
                { keys: [lockKey], args: [token, `${holdInMs}`] }
            );
            if (renewed !== 1) {
                this.logger.warn(
                    `Lost the lock "${key}" while still working - another instance may already be running the same code`
                );
            }
        }
        catch (error) {
            this.logger.warn(`Could not renew the lock "${key}": ${error instanceof Error ? error.message : error}`);
        }
    }

    /**
     * Takes a grant on a valkey key, queueing until it is free or until waiting stops being
     * reasonable.
     *
     * Native rather than a row in the `Lease` table on purpose. The surface is the same either way,
     * and this is the store's own data - reaching across to another data source for permission to
     * write one of its own keys would put a round trip to somewhere else in front of every write.
     *
     * Only the acquisition lives here. Keeping the grant alive and handing it back is
     * `LeaseService`'s job, and the `HeldLease` this returns is exactly the handle it takes.
     * @param key - What to take a grant on.
     * @param holdInMs - How long the grant lives before it lapses. Renewed while it is held.
     * @param timeoutInMs - How long to queue before giving up.
     * @returns The grant, ready to be held.
     * @throws When the wait ran out, which is also how a deadlock ends.
     */
    protected async acquireNativeGrant(key: string, holdInMs: number, timeoutInMs: number): Promise<HeldLease> {
        if (!this.client) {
            throw new DataSourceInitializationError();
        }
        const client: GlideClient = this.client;
        const deadline: number = Date.now() + timeoutInMs;
        const lockKey: string = `${LOCK_KEY_PREFIX}${key}`;

        // unique to this acquisition, and checked by both the renewal and the release. Without it
        // neither can tell "my lock" from "a lock", and a holder whose key had already lapsed would
        // go on to free the one that replaced it.
        const token: string = UUIDUtilities.generate();

        // the key carries a time to live, so an instance that dies holding it does not lock the
        // others out for good - it only delays them by that much
        while (
            await client.set(
                lockKey,
                token,
                { conditionalSet: 'onlyIfDoesNotExist', expiry: { type: valKeyGlide().TimeUnit.Milliseconds, count: holdInMs } }
            ) == undefined
        ) {
            if (Date.now() > deadline) {
                throw new InternalError(
                    `Could not acquire the lock "${key}" within ${timeoutInMs}ms - another instance is still holding it`
                );
            }
            await new Promise<void>(resolve => {
                setTimeout(resolve, LOCK_RETRY_IN_MS);
            });
        }

        return {
            name: key,
            renew: async () => await this.renewLock(client, lockKey, token, holdInMs, key),
            // conditional on the token, so a holder whose key had already lapsed cannot free the
            // lock that replaced it - see evaluation/10-leases-and-claims.md 10.1
            release: async () => {
                await client.invokeScript(releaseLockScript(), { keys: [lockKey], args: [token] });
            }
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async schemaLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
        const holdInMs: number = inject(ZIBRI_DI_TOKENS.SCHEMA_LOCK_HOLD_IN_MS);

        // acquired before the hold and not inside it: taking a grant can fail by running out of
        // patience, which is not something a grant that is already held can do. The hold then
        // follows the work rather than the work having to fit the hold - schemaLock takes an
        // arbitrary function and never says how long it may run for.
        const lease: HeldLease = await this.acquireNativeGrant(
            key,
            holdInMs,
            inject(ZIBRI_DI_TOKENS.SCHEMA_LOCK_TIMEOUT_IN_MS)
        );

        return await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).hold(lease, holdInMs, fn);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/require-await
    async shutDown(): Promise<void> {
        this.client?.close();
        this.client = undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getRepository<T extends BaseEntity>(cls: Newable<T>): RepositoryTypeForEntity<T> {
        if (!this.client) {
            throw new DataSourceInitializationError();
        }
        if (!this.entities.includes(cls)) {
            throw new InternalError([
                `The entity "${cls.name}" is not in this database.`,
                'Did you forget to include it in the entities array?'
            ]);
        }

        // eslint-disable-next-line stylistic/max-len
        const existingRepository: RepositoryTypeForEntity<T> | undefined = this.repositories.get(cls) as RepositoryTypeForEntity<T> | undefined;
        if (existingRepository) {
            return existingRepository;
        }

        const driver: ValKeyRepositoryDriver<T> = new ValKeyRepositoryDriver(cls, this.client, this.keyPrefix, this);

        if (isSoftDeleteEntityNewable(cls)) {
            const res: RepositoryTypeForEntity<T> = new SoftDeleteRepository(
                cls,
                driver as unknown as RepositoryDriverInterface<SoftDeleteEntity>,
                this.logger,
                this,
                getDefaultBeforeSaveHook(),
                getDefaultBeforeReturnHook(),
                this.authService,
                this.getRepository(ChangeSet)
            ) as RepositoryTypeForEntity<T>;
            this.repositories.set(cls, res as Repository<BaseEntity>);
            return res;
        }
        if (isChangeSetEntityNewable(cls)) {
            const res: RepositoryTypeForEntity<T> = new ChangeSetRepository(
                cls,
                driver as unknown as RepositoryDriverInterface<ChangeSetEntity>,
                this.logger,
                this,
                getDefaultBeforeSaveHook(),
                getDefaultBeforeReturnHook(),
                this.authService,
                this.getRepository(ChangeSet)
            ) as RepositoryTypeForEntity<T>;
            this.repositories.set(cls, res as Repository<BaseEntity>);
            return res;
        }

        const res: RepositoryTypeForEntity<T> = new Repository<T>(
            cls,
            driver,
            this.logger,
            this,
            getDefaultBeforeSaveHook(),
            getDefaultBeforeReturnHook()
        ) as RepositoryTypeForEntity<T>;
        this.repositories.set(cls, res as Repository<BaseEntity>);
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    startTransaction(options?: StartTransactionOptions): Transaction {
        if (!this.client) {
            throw new DataSourceInitializationError();
        }
        if (options?.isolationLevel != undefined) {
            this.logger.warn(
                `The data source "${this.constructor.name}" does not support isolation levels,`
                + ` "${options.isolationLevel}" is ignored.`
            );
        }

        const holdInMs: number = inject(ZIBRI_DI_TOKENS.VAL_KEY_TRANSACTION_LOCK_HOLD_IN_MS);
        const timeoutInMs: number = inject(ZIBRI_DI_TOKENS.VAL_KEY_TRANSACTION_LOCK_TIMEOUT_IN_MS);

        return new ValKeyTransaction(
            this.client,
            async key => inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).keepAlive(
                await this.acquireNativeGrant(key, holdInMs, timeoutInMs),
                holdInMs
            ),
            options?.idleTimeoutInMs ?? DEFAULT_TRANSACTION_IDLE_TIMEOUT_IN_MS,
            this.logger
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async runMigrations(): Promise<void> {
        await runMigrations(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revertMigrationsAfter(targetVersion: SemVerVersion): Promise<void> {
        await revertMigrationsAfter(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger, targetVersion);
    }

    /**
     * Adds a new property to every entity that is already stored.
     *
     * Valkey has no schema, so this only writes the default value (or null) of the new property into
     * the hashes that exist already.
     * @param entity - The entity class that the property was added to.
     * @param key - The key of the new property.
     * @param transaction - The transaction to run the operation in.
     * @throws When the property does not exist on the entity class.
     */
    async addPropertyToEntity<T extends BaseEntity>(entity: Newable<T>, key: keyof T, transaction: Transaction): Promise<void> {
        const metadata: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(entity)[String(key)];
        if (metadata == undefined) {
            throw new InternalError(`The property "${entity.name}.${String(key)}" does not exist.`);
        }
        const value: unknown = 'default' in metadata && metadata.default !== undefined

            ? typeof metadata.default === 'function' ? (metadata.default as () => unknown)() : metadata.default
            // eslint-disable-next-line unicorn/no-null
            : null;

        await this.updateStoredRows(entity, transaction, row => {
            if (String(key) in row) {
                return undefined;
            }
            return { values: { [String(key)]: JSON.stringify(value) } };
        });
    }

    /**
     * Renames a property of every entity that is already stored.
     *
     * Valkey has no schema, so a changed type does not need to be applied to the storage itself. Only
     * a changed name has to be, by moving the value of the old field over to the new one.
     * @param entity - The entity class that the property belongs to.
     * @param oldProperty - The current key of the property.
     * @param newProperty - The new definition of the property.
     * @param transaction - The transaction to run the operation in.
     */
    async changePropertyOfEntity<T extends BaseEntity>(
        entity: Newable<T>,
        oldProperty: keyof T | string & {},
        newProperty: PropertyMetadataInput & {
            /**
             * The name of the new column.
             */
            name?: keyof T | string & {},
            /**
             * The type of the new column.
             */
            type: ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity> | FilePropertyMetadata>['type']
        },
        transaction: Transaction
    ): Promise<void> {
        const oldKey: string = String(oldProperty);
        const newKey: string = String(newProperty.name ?? oldProperty);
        if (oldKey === newKey) {
            return;
        }

        await this.updateStoredRows(entity, transaction, row => {
            const value: string | undefined = row[oldKey];
            if (value == undefined) {
                return undefined;
            }
            return { values: { [newKey]: value }, remove: [oldKey] };
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateBackupConfiguration(): void {
        // a valkey backup only needs the connection that the data source already has
    }

    /**
     * Creates a backup of every key of this data source.
     *
     * Each line of the returned stream is one json encoded key, as produced by the DUMP command.
     * @returns A readable stream of the backup data.
     * @throws When the data source has not been initialized yet.
     */
    createBackupData(): Readable {
        const client: GlideClient | undefined = this.client;
        if (!client) {
            throw new DataSourceInitializationError();
        }
        const pattern: string = `${this.keyPrefix}:*`;

        return Readable.from((async function* generateBackupData(): AsyncGenerator<string> {
            for (const key of await scanKeys(client, pattern)) {
                const payload: Awaited<ReturnType<GlideClient['dump']>> = await client.dump(key);
                if (payload == undefined) {
                    continue;
                }
                // eslint-disable-next-line cspell/spellchecker
                const ttlMs: number = await client.pttl(key);
                const entry: ValKeyBackupEntry = {
                    key,
                    ttlMs: ttlMs > 0 ? ttlMs : 0,
                    payload: Buffer.from(payload).toString('base64')
                };
                yield `${JSON.stringify(entry)}\n`;
            }
        })());
    }

    /**
     * Restores the given backup data.
     *
     * The whole backup is read into a staging area first and only swapped in once all of it has
     * arrived, so that a stream which is cut, a line which does not parse or a key which will not
     * restore leaves what is already stored exactly as it was. Deleting first would turn every one
     * of those into a store that is wiped and half filled, with nothing left to roll back to.
     *
     * The swap is one batch: everything that was there is removed and everything staged takes its
     * place, so no reader sees half of the old state and half of the new one. Keys which did not
     * exist when the backup was created therefore do not survive the restore.
     * @param backupData - The backup data to restore.
     * @throws When the data source has not been initialized yet, or when the backup could not be
     * read - in which case nothing has been changed.
     */
    async restoreBackup(backupData: Readable): Promise<void> {
        const client: GlideClient | undefined = this.client;
        if (!client) {
            throw new DataSourceInitializationError();
        }

        const staged: string[] = await this.stageBackup(client, backupData);
        // staged keys live under this prefix too, so they have to be kept out of what is swept away
        const existingKeys: string[] = (await scanKeys(client, `${this.keyPrefix}:*`))
            .filter(k => !k.startsWith(this.stagingPrefix()));

        if (!existingKeys.length && !staged.length) {
            return;
        }

        const batch: Batch = new (valKeyGlide().Batch)(true);
        if (existingKeys.length) {
            batch.del(existingKeys);
        }
        for (const key of staged) {
            batch.rename(key, key.slice(this.stagingPrefix().length));
        }
        if (await client.exec(batch, true) == undefined) {
            throw new InternalError('The restored backup could not be swapped in.');
        }
    }

    /**
     * Restores every entry of the backup under the staging prefix.
     *
     * Nothing that is already stored is touched here. A failure part way through leaves only staged
     * keys behind, which are cleaned up before the error is passed on.
     * @param client - The client to restore through.
     * @param backupData - The backup data to read.
     * @returns The staged keys, in the order they were restored.
     * @throws Whatever reading or restoring the backup threw.
     */
    private async stageBackup(client: GlideClient, backupData: Readable): Promise<string[]> {
        const staged: string[] = [];
        try {
            let rest: string = '';
            for await (const chunk of backupData) {
                rest += String(chunk);
                const lines: string[] = rest.split('\n');
                rest = lines.pop() ?? '';
                for (const line of lines) {
                    staged.push(...await this.restoreEntry(client, line));
                }
            }
            staged.push(...await this.restoreEntry(client, rest));
            return staged;
        }
        catch (error) {
            if (staged.length) {
                await client.del(staged);
            }
            throw error;
        }
    }

    /**
     * The namespace staged keys are restored under while a backup is being read.
     * @returns The prefix, including its trailing separator.
     */
    private stagingPrefix(): string {
        return `${this.keyPrefix}:${RESTORE_STAGING_SEGMENT}:`;
    }

    /**
     * Validates the data source options.
     * @param options - The full options to validate.
     */
    // eslint-disable-next-line unusedImports/no-unused-vars
    protected validateOptions(options: ValKeyOptions): void | Promise<void> {
        // do nothing by default.
    }

    /**
     * Validates that the given entity can be stored in a valkey data source.
     * @param entityClass - The entity class to validate.
     * @throws When the entity has no or more than one primary key.
     */
    protected validateEntity(entityClass: Newable<BaseEntity>): void {
        const entityMetadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entityClass);
        if (!entityMetadata) {
            throw new EntityMetadataMissingError(entityClass);
        }
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        const primaryKeys: string[] = ObjectUtilities.entries(properties)
            .filter(([, p]) => 'primary' in p && p.primary)
            .map(([k]) => k);

        if (!primaryKeys.length) {
            throw new InternalError(`no primary key specified for entity "${entityClass.name}".`);
        }
        if (primaryKeys.length > 1) {
            throw new InternalError(`more than 1 primary key specified for entity "${entityClass.name}".`);
        }
    }

    private async restoreEntry(client: GlideClient, line: string): Promise<string[]> {
        if (!line.trim()) {
            return [];
        }
        const entry: ValKeyBackupEntry = JSON.parse(line) as ValKeyBackupEntry;
        const stagedKey: string = `${this.stagingPrefix()}${entry.key}`;
        await client.restore(stagedKey, entry.ttlMs, Buffer.from(entry.payload, 'base64'), { replace: true });
        return [stagedKey];
    }

    /**
     * Reads every stored row of the given entity and applies the given update to it.
     * @param entity - The entity class which rows should be updated.
     * @param transaction - The transaction to run the operation in.
     * @param update - Produces the fields to write and remove, or undefined when the row stays untouched.
     */
    private async updateStoredRows<T extends BaseEntity>(
        entity: Newable<T>,
        transaction: Transaction,
        update: (row: Record<string, string>) => UpdateStoredRowsResult | undefined
    ): Promise<void> {
        if (!this.client) {
            throw new DataSourceInitializationError();
        }
        if (!(transaction instanceof ValKeyTransaction)) {
            throw new InternalError('The provided transaction does not belong to a valkey data source.');
        }

        const entityMetadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entity);
        if (!entityMetadata) {
            throw new EntityMetadataMissingError(entity);
        }

        const idsKey: string = `${this.keyPrefix}:${entityMetadata.tableName}:ids`;
        // eslint-disable-next-line cspell/spellchecker
        for (const id of await this.client.smembers(idsKey)) {
            const key: string = `${this.keyPrefix}:${entityMetadata.tableName}:${toStringValue(id)}`;
            const stored: Record<string, string> = Object.fromEntries(
                // eslint-disable-next-line cspell/spellchecker
                (await this.client.hgetall(key)).map(e => [toStringValue(e.field), toStringValue(e.value)])
            );
            const row: Record<string, string> | undefined = transaction.resolveHash(key, stored);
            if (row == undefined) {
                continue;
            }

            const res: UpdateStoredRowsResult | undefined = update(row);
            if (res == undefined) {
                continue;
            }
            await transaction.add({ type: 'hashSet', key, values: res.values });
            if (res.remove?.length) {
                await transaction.add({ type: 'hashDelete', key, fields: res.remove });
            }
        }
    }
}

/**
 * Collects all keys that match the given pattern using a cursor based scan.
 * @param client - The client to scan with.
 * @param pattern - The glob style pattern that the keys need to match.
 * @returns All matching keys.
 */
async function scanKeys(client: GlideClient, pattern: string): Promise<string[]> {
    const res: string[] = [];
    let cursor: string = '0';

    do {
        const [nextCursor, keys]: [GlideString, GlideString[]] = await client.scan(cursor, { match: pattern, count: 250 });
        cursor = toStringValue(nextCursor);
        res.push(...keys.map(k => toStringValue(k)));
    }
    while (cursor !== '0');

    return res;
}

/**
 * Converts a value that valkey returned to a string.
 * @param value - The value to convert.
 * @returns The value as a string.
 */
function toStringValue(value: GlideString): string {
    return typeof value === 'string' ? value : Buffer.from(value).toString('utf8');
}