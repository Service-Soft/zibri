import { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import type { Batch, GlideClient, GlideClientConfiguration, GlideString, PubSubMsg, Script } from '@valkey/valkey-glide';

import { scanValKeyKeys } from './scan-val-key-keys.function.ts';
import { valKeyGlide } from './val-key-glide.function.ts';
import { type AuthServiceInterface } from '../../../auth/auth-service.interface.ts';
import { ChangeSetRepository } from '../../../change-sets/change-set-repository.ts';
import { ChangeSetEntity } from '../../../change-sets/models/change-set-entity.model.ts';
import { ChangeSet } from '../../../change-sets/models/change-set.model.ts';
import { isChangeSetEntityNewable } from '../../../change-sets/models/is-change-set-entity.function.ts';
import { isSoftDeleteEntityNewable } from '../../../change-sets/models/is-soft-delete-entity.function.ts';
import { SoftDeleteEntity } from '../../../change-sets/models/soft-delete-entity.model.ts';
import { SoftDeleteRepository } from '../../../change-sets/soft-delete-repository.ts';
import { Inject } from '../../../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { EntityMetadata } from '../../../entity/decorators/entity.decorator.ts';
import { PropertyMetadata } from '../../../entity/decorators/property.decorator.ts';
import { EntityMetadataMissingError } from '../../../entity/entity-metadata-missing.error.ts';
import { InternalError } from '../../../error-handling/internal-error.model.ts';
import { HeldLease, KeptGrant } from '../../../leases/held-lease.model.ts';
import { type LoggerInterface } from '../../../logging/logger.interface.ts';
import { Newable } from '../../../types/newable.type.ts';
import { OmitStrict } from '../../../types/omit-strict.type.ts';
import { JsonUtilities } from '../../../utilities/json.utilities.ts';
import { MetadataUtilities } from '../../../utilities/metadata.utilities.ts';
import { ObjectUtilities } from '../../../utilities/object.utilities.ts';
import { PromiseUtilities } from '../../../utilities/promise.utilities.ts';
import { UUIDUtilities } from '../../../utilities/uuid.utilities.ts';
import { SemVerVersion } from '../../../versioning/sem-ver.utilities.ts';
import { RepositoryDriverInterface } from '../../driver/repository-driver.interface.ts';
import { StoredRowChange, ValKeyRepositoryDriver } from '../../driver/val-key.repository-driver.ts';
import { registerRepositoryProvidersFor } from '../../entity-ownership.function.ts';
import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook } from '../../hooks/hooks.default.ts';
import { MigratedEntityUtilities } from '../../migration/migrated-entity.utilities.ts';
import { Migration } from '../../migration/migration.model.ts';
import { recordKeyReconciliation, revertMigrationsAfter, runMigrations } from '../../migration/run-migrations.function.ts';
import { AddPropertyToEntityInput } from '../../models/add-property-to-entity-input.model.ts';
import { ChangePropertyOfEntityInput } from '../../models/change-property-of-entity-input.model.ts';
import { ConvertedValue } from '../../models/converted-value.model.ts';
import { MergeEntityInput } from '../../models/merge-entity-input.model.ts';
import { MigrationPropertyMetadata } from '../../models/migration-property-metadata.model.ts';
import { RefusedValue } from '../../models/refused-value.model.ts';
import { RemovePropertyFromEntityInput } from '../../models/remove-property-from-entity-input.model.ts';
import { RenameEntityInput } from '../../models/rename-entity-input.model.ts';
import { ResolvedPropertyConversion } from '../../models/resolved-property-conversion.model.ts';
import { Repository } from '../../repository/repository.ts';
import { Transaction } from '../../transaction/transaction.model.ts';
import { ValKeyTransaction, ValKeyTransactionGrants } from '../../transaction/val-key-transaction.model.ts';
import { ValueConversionUtilities } from '../../value-conversion.utilities.ts';
import { DataSourceInitializationError } from '../data-source-initialization.error.ts';
import { DataSourceInterface, RepositoryTypeForEntity, SCHEMA_LOCK_KEY, StartTransactionOptions } from '../data-source.interface.ts';
import { DataSourceSubscription, PubSubDataSourceInterface } from '../pub-sub-data-source.interface.ts';

/**
 * ValKey-specific connection options.
 */
export type ValKeyOptions = OmitStrict<GlideClientConfiguration, 'addresses' | 'useTLS'> & {
    /**
     * Whether the connection uses tls.
     *
     * `true` encrypts it and verifies the server's certificate, `false` connects unencrypted.
     */
    useTLS: boolean,
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
     * The updated values, if any.
     */
    values?: Record<string, string>,
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
 * How many locks one call of the renew or release script covers.
 *
 * Bounded rather than all of them, because a script runs alone on the server and a transaction holds
 * as many locks as it wrote rows.
 */
const LOCKS_PER_SCRIPT: number = 1000;

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
 * The lua scripts a lock needs, each once it has been built.
 */
type LockScripts = {
    /**
     * Takes locks that are free, in the order given, up to the first one somebody else holds.
     */
    acquire?: Script,
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
 * Takes the given locks in the order they are given, and stops at the first one somebody else holds.
 * Answers how many it took, which are always the first ones.
 *
 * Stopping rather than skipping is what keeps the order: a caller holds a prefix of its keys and
 * waits on the next one, exactly as it would taking them one by one, so two callers that sort their
 * keys the same way can never each hold what the other waits on. A key this caller already holds
 * counts as taken.
 * @returns The script.
 */
function acquireLockScript(): Script {
    lockScripts.acquire ??= new (valKeyGlide().Script)(
        'for i = 1, #KEYS do '
        + 'local holder = redis.call("get", KEYS[i]) '
        + 'if not holder then redis.call("set", KEYS[i], ARGV[1], "PX", ARGV[2]) '
        + 'elseif holder ~= ARGV[1] then return i - 1 end '
        + 'end return #KEYS'
    );
    return lockScripts.acquire;
}

/**
 * Frees the locks among the given keys that are still the ones this caller took, and answers how
 * many that was.
 *
 * `del` on its own cannot express that. Without the check, a holder whose lease had already expired
 * would delete whatever key now sits there - which is somebody else's lock - and every later caller
 * would then be releasing the lock of the one before it.
 *
 * Every key in one call, because a transaction holds one lock per key it wrote, and a round trip per
 * lock is as many requests at once as the transaction wrote rows.
 * @returns The script.
 */
function releaseLockScript(): Script {
    lockScripts.release ??= new (valKeyGlide().Script)(
        'local n = 0 for i = 1, #KEYS do '
        + 'if redis.call("get", KEYS[i]) == ARGV[1] then n = n + redis.call("del", KEYS[i]) end '
        + 'end return n'
    );
    return lockScripts.release;
}

/**
 * Pushes the expiry of the given locks out, but only of those still this caller's, and answers how
 * many that was.
 *
 * Fewer than were given means some are not, and no amount of extending would make them so again.
 * Every key in one call, for the reason the release takes them together.
 * @returns The script.
 */
function renewLockScript(): Script {
    lockScripts.renew ??= new (valKeyGlide().Script)(
        'local n = 0 for i = 1, #KEYS do '
        + 'if redis.call("get", KEYS[i]) == ARGV[1] then n = n + redis.call("pexpire", KEYS[i], ARGV[2]) end '
        + 'end return n'
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly migrations: Newable<Migration>[] = [];

    /**
     * The configuration options of the data source.
     */
    abstract readonly options: ValKeyOptions;

    /**
     * The default configuration options of the data source.
     */
    protected readonly defaultOptions: Partial<ValKeyOptions> = {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'zibri',
        requestTimeout: 5000
    };

    // eslint-disable-next-line jsdoc-js/require-returns
    /**
     * Combination of the default and user provided options.
     */
    protected get fullOptions(): ValKeyOptions {
        return {
            ...this.defaultOptions,
            ...this.options
        };
    }

    // eslint-disable-next-line jsdoc-js/require-returns
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

    // eslint-disable-next-line jsdoc-js/require-returns
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async init(): Promise<void> {
        if (this.client) {
            throw new InternalError('The data source has already been initialized.');
        }

        // eslint-disable-next-line no-unused-vars
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
            if (await this.reconcileKeys()) {
                await recordKeyReconciliation(this.constructor as Newable<DataSourceInterface>);
            }
        });
    }

    /**
     * Brings the indexes and uniques kept for every entity in line with what the entities declare.
     * @returns Whether any entity's changed.
     * @throws When stored rows break a unique an entity declares.
     */
    private async reconcileKeys(): Promise<boolean> {
        const client: GlideClient | undefined = this.client;
        if (!client) {
            throw new DataSourceInitializationError();
        }
        // one entity after the other rather than together: each reads every row it stores, and a
        // boot reading all of them at once holds all of them at once
        let changed: boolean = false;
        for (const entity of this.entities) {
            changed = await new ValKeyRepositoryDriver(entity, client, this.keyPrefix, this).reconcileStoredKeys() || changed;
        }
        return changed;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async publish(channel: string, message: string): Promise<void> {
        if (!this.client) {
            throw new DataSourceInitializationError();
        }
        await this.client.publish(message, `${this.keyPrefix}:${channel}`);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async subscribe(channel: string, onMessage: (message: string) => void): Promise<DataSourceSubscription> {
        // eslint-disable-next-line no-unused-vars
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
     * Pushes the expiry of locks out while the work is still running.
     *
     * Losing one is reported rather than acted on. Cancelling the work half way would leave whatever
     * it had already written behind, which is not obviously better than finishing - and the release
     * checks the token anyway, so a lapsed holder cannot take somebody else's lock away on its way
     * out. What must not happen is losing it silently.
     * @param client - The client holding the locks.
     * @param lockKeys - The namespaced keys the locks live under.
     * @param token - The token this caller took the locks with.
     * @param holdInMs - How much longer the locks should live.
     * @param name - What holds them, for the log message.
     */
    private async renewLocks(
        client: GlideClient,
        lockKeys: string[],
        token: string,
        holdInMs: number,
        name: string
    ): Promise<void> {
        try {
            const renewed: number[] = await PromiseUtilities.allChunked(
                PromiseUtilities.resolveChunks(lockKeys, LOCKS_PER_SCRIPT),
                async keys => Number(await client.invokeScript(renewLockScript(), { keys, args: [token, `${holdInMs}`] }))
            );
            const lost: number = lockKeys.length - renewed.reduce((sum, n) => sum + n, 0);
            if (lost > 0) {
                const what: string = lockKeys.length === 1 ? 'the lock' : `${lost} of the locks of`;
                this.logger.warn(
                    `Lost ${what} "${name}" while still working - another instance may already be running the same code`
                );
            }
        }
        catch (error) {
            // oxlint-disable-next-line typescript/restrict-template-expressions
            this.logger.warn(`Could not renew the lock "${name}": ${error instanceof Error ? error.message : error}`);
        }
    }

    /**
     * Frees the locks among the given keys that are still this caller's.
     * @param client - The client holding the locks.
     * @param lockKeys - The namespaced keys the locks live under.
     * @param token - The token this caller took the locks with.
     */
    private async releaseLocks(client: GlideClient, lockKeys: string[], token: string): Promise<void> {
        // conditional on the token, so a holder whose key had already lapsed cannot free the lock
        // that replaced it - see evaluation/10-leases-and-claims.md 10.1
        await PromiseUtilities.allChunked(
            PromiseUtilities.resolveChunks(lockKeys, LOCKS_PER_SCRIPT),
            async keys => await client.invokeScript(releaseLockScript(), { keys, args: [token] })
        );
    }

    /**
     * Takes locks under the given token, queueing on each one until it is free or until waiting stops
     * being reasonable.
     *
     * Taken in sorted order, whatever order they were given in, so two callers wanting keys in common
     * take those in the same order and never each hold what the other waits on.
     * @param client - The client to take them through.
     * @param keys - The unprefixed keys to lock.
     * @param token - The token that says whose they are.
     * @param holdInMs - How long a lock lives before it lapses.
     * @param timeoutInMs - How long to queue on one lock before giving up.
     * @param held - Where each lock goes as soon as it is taken, so that locks taken before a wait
     * are already being kept alive while it lasts, and are handed back when it runs out.
     * @throws When a wait ran out, which is also how a deadlock ends.
     */
    private async acquireLocks(
        client: GlideClient,
        keys: string[],
        token: string,
        holdInMs: number,
        timeoutInMs: number,
        held: Set<string>
    ): Promise<void> {
        const lockKeys: string[] = [...new Set(keys)].sort().map(key => `${LOCK_KEY_PREFIX}${key}`);
        // one group after the other rather than together: taking them in order is the point, and a
        // later group taken while an earlier one waits would be holding keys out of it
        for (const group of PromiseUtilities.resolveChunks(lockKeys, LOCKS_PER_SCRIPT)) {
            let waiting: string[] = group;
            let deadline: number = Date.now() + timeoutInMs;
            while (waiting.length) {
                // each lock carries a time to live, so an instance that dies holding it does not lock
                // the others out for good - it only delays them by that much
                const taken: number = Number(
                    await client.invokeScript(acquireLockScript(), { keys: waiting, args: [token, `${holdInMs}`] })
                );
                for (const lockKey of waiting.slice(0, taken)) {
                    held.add(lockKey);
                }
                waiting = waiting.slice(taken);
                if (!waiting.length) {
                    break;
                }
                // the timeout is how long one lock may keep this waiting, as it was when they were
                // taken one call each, so any progress starts it again
                if (taken > 0) {
                    deadline = Date.now() + timeoutInMs;
                }
                if (Date.now() > deadline) {
                    throw new InternalError(
                        `Could not acquire the lock "${waiting[0]?.slice(LOCK_KEY_PREFIX.length)}" within ${timeoutInMs}ms`
                        + ' - another instance is still holding it'
                    );
                }
                await new Promise<void>(resolve => {
                    setTimeout(resolve, LOCK_RETRY_IN_MS);
                });
            }
        }
    }

    /**
     * Opens the grants of one transaction: a lock per key it writes, all under one token and kept
     * alive as one lease.
     *
     * One lease rather than one per key, because a transaction holds as many keys as it wrote rows.
     * Kept one by one, each would renew on a timer of its own and be released in a call of its own, so
     * a transaction writing a large batch would put that many requests on the client at once.
     * @param client - The client to take the locks through.
     * @param holdInMs - How long a lock lives before it lapses. Renewed while it is held.
     * @param timeoutInMs - How long a claim queues before giving up.
     * @returns The grants.
     */
    private openTransactionGrants(client: GlideClient, holdInMs: number, timeoutInMs: number): ValKeyTransactionGrants {
        // unique to this transaction, and checked by both the renewal and the release
        const token: string = UUIDUtilities.generate();
        const held: Set<string> = new Set();
        const lease: HeldLease = {
            name: `transaction ${token}`,
            renew: async () => await this.renewLocks(client, [...held], token, holdInMs, `transaction ${token}`),
            release: async () => await this.releaseLocks(client, [...held], token)
        };
        let kept: KeptGrant | undefined;
        let released: boolean = false;

        return {
            claim: async keys => {
                // kept alive from before the first lock is taken rather than after the last: a claim
                // may queue between two of its locks, and the ones it took first have to outlive that
                if (!released) {
                    kept ??= inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).keepAlive(lease, holdInMs);
                }
                await this.acquireLocks(client, keys, token, holdInMs, timeoutInMs, held);
                // the transaction can end while this is queueing, because its idle timeout ends it
                // from a timer rather than from whoever is writing. What it held went back as it
                // ended, and what this took arrived after that - so it goes back on its own
                if (released) {
                    await this.releaseLocks(client, keys.map(key => `${LOCK_KEY_PREFIX}${key}`), token);
                }
            },
            release: async () => {
                released = true;
                await kept?.release();
            }
        };
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
        const lockKey: string = `${LOCK_KEY_PREFIX}${key}`;

        // unique to this acquisition, and checked by both the renewal and the release. Without it
        // neither can tell "my lock" from "a lock", and a holder whose key had already lapsed would
        // go on to free the one that replaced it.
        const token: string = UUIDUtilities.generate();
        await this.acquireLocks(client, [key], token, holdInMs, timeoutInMs, new Set());

        return {
            name: key,
            renew: async () => await this.renewLocks(client, [lockKey], token, holdInMs, key),
            release: async () => await this.releaseLocks(client, [lockKey], token)
        };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc, typescript/require-await
    async shutDown(): Promise<void> {
        this.client?.close();
        this.client = undefined;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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
            this.openTransactionGrants(this.client, holdInMs, timeoutInMs),
            options?.idleTimeoutInMs ?? DEFAULT_TRANSACTION_IDLE_TIMEOUT_IN_MS,
            this.logger
        );
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async runMigrations(): Promise<void> {
        await runMigrations(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async revertMigrationsAfter(targetVersion: SemVerVersion): Promise<void> {
        await revertMigrationsAfter(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger, targetVersion);
    }

    /**
     * Adds a new property to every entity that is already stored.
     *
     * Valkey has no schema, so this only writes the default value (or null) of the new property into
     * the hashes that exist already.
     * @param input - The entity, the property and the transaction.
     */
    async addPropertyToEntity<T extends BaseEntity>(input: AddPropertyToEntityInput<T>): Promise<void> {
        const name: string = String(input.property.name);
        const metadata: PropertyMetadata = MigratedEntityUtilities.resolvePropertyMetadata(input.property);
        const value: unknown = 'default' in metadata && metadata.default !== undefined

            ? typeof metadata.default === 'function' ? (metadata.default as () => unknown)() : metadata.default
            // eslint-disable-next-line unicorn/no-null
            : null;

        await this.updateStoredRows(input.entity, input.transaction, row => {
            if (name in row) {
                return undefined;
            }
            return { values: { [name]: JsonUtilities.stringify(value) } };
        });
    }

    /**
     * Changes a property of every entity that is already stored.
     *
     * Valkey has no schema, so what changes is the value each hash holds: moved to the new field when
     * the property is renamed, and converted into its new type.
     * @param input - What to change and how.
     * @throws When a stored value is neither listed nor converted, naming every such value.
     */
    async changePropertyOfEntity<T extends BaseEntity, C extends MigrationPropertyMetadata, M extends MigrationPropertyMetadata>(
        input: ChangePropertyOfEntityInput<T, C, M>
    ): Promise<void> {
        const conversion: ResolvedPropertyConversion = ValueConversionUtilities.resolveConversion(input);
        const renames: boolean = conversion.currentName !== conversion.changedName;

        const refused: RefusedValue[] = [];
        await this.updateStoredRows(input.entity, input.transaction, row => {
            const stored: string | undefined = row[conversion.currentName];
            // a field that is not there is a value that is null, which a change lists and converts alike
            const converted: ConvertedValue | RefusedValue = ValueConversionUtilities.resolveConvertedValue(
                // eslint-disable-next-line unicorn/no-null
                stored == undefined ? null : JsonUtilities.parse(stored),
                conversion
            );
            if ('refusal' in converted) {
                refused.push(converted);
                return undefined;
            }
            if (stored == undefined && converted.value === null) {
                return undefined;
            }
            return {
                values: { [conversion.changedName]: JsonUtilities.stringify(converted.value) },
                remove: renames ? [conversion.currentName] : undefined
            };
        });
        // after every row rather than at the first, so that the migration names all of them at once.
        // Nothing is written: what the rows above were given stays in the transaction, which failing
        // the migration rolls back
        ValueConversionUtilities.validateNothingRefused(conversion, refused);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async removePropertyFromEntity<T extends BaseEntity>(input: RemovePropertyFromEntityInput<T>): Promise<void> {
        await this.updateStoredRows(
            input.entity,
            input.transaction,
            row => String(input.propertyKey) in row ? { remove: [String(input.propertyKey)] } : undefined
        );
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async renameEntity<T extends BaseEntity>(input: RenameEntityInput<T>): Promise<void> {
        if (!this.client) {
            throw new DataSourceInitializationError();
        }
        await new ValKeyRepositoryDriver(input.entity, this.client, this.keyPrefix, this)
            .moveStoredKeysFrom(input.currentTableName, input.transaction);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async mergeEntity<T extends BaseEntity>(input: MergeEntityInput<T>): Promise<void> {
        if (!this.client) {
            throw new DataSourceInitializationError();
        }
        await new ValKeyRepositoryDriver(input.entity, this.client, this.keyPrefix, this)
            .mergeStoredKeysFrom(input.currentTableName, input.transaction);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async createEntity(): Promise<void> {
        // valkey has no schema: an entity's keys come into being with its first row, and the keys of
        // its indexes and uniques with the reconciliation that follows the migrations
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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
            for (const key of await scanValKeyKeys(client, pattern)) {
                const payload: Awaited<ReturnType<GlideClient['dump']>> = await client.dump(key);
                if (payload == undefined) {
                    continue;
                }
                // cspell:disable-next-line
                const ttlMs: number = await client.pttl(key);
                const entry: ValKeyBackupEntry = {
                    key,
                    ttlMs: ttlMs > 0 ? ttlMs : 0,
                    payload: Buffer.from(payload).toString('base64')
                };
                yield `${JsonUtilities.stringify(entry)}\n`;
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
        const existingKeys: string[] = (await scanValKeyKeys(client, `${this.keyPrefix}:*`))
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
            // a decoder rather than a string per chunk: the data arrives as bytes, and a character
            // spanning two chunks decoded one chunk at a time comes out as two replacement characters
            const decoder: StringDecoder = new StringDecoder('utf8');
            for await (const chunk of backupData) {
                rest += Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk);
                const lines: string[] = rest.split('\n');
                rest = lines.pop() ?? '';
                for (const line of lines) {
                    staged.push(...await this.restoreEntry(client, line));
                }
            }
            rest += decoder.end();
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
    // eslint-disable-next-line no-unused-vars
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
        const entry: ValKeyBackupEntry = JsonUtilities.parse(line);
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
        const changes: StoredRowChange[] = [];
        // cspell:disable-next-line
        const storedIds: string[] = [...await this.client.smembers(idsKey)].map(id => toStringValue(id));
        // with the ids the transaction holds besides, which are the rows the migration created or
        // moved here by renaming the entity, before this step
        for (const id of transaction.resolveSetMembers(idsKey, storedIds)) {
            const key: string = `${this.keyPrefix}:${entityMetadata.tableName}:${id}`;
            const stored: Record<string, string> = Object.fromEntries(
                // cspell:disable-next-line
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
            if (res.values != undefined) {
                await transaction.add({ type: 'hashSet', key, values: res.values });
            }
            if (res.remove?.length) {
                await transaction.add({ type: 'hashDelete', key, fields: res.remove });
            }
            const after: Record<string, string> = { ...row, ...res.values };
            for (const field of res.remove ?? []) {
                // eslint-disable-next-line typescript/no-dynamic-delete
                delete after[field];
            }
            changes.push({ id, before: row, after });
        }
        // the indexes are the driver's, and were built from the values as they were: a value converted
        // here and left in its old entry would be found under what it no longer holds - and, for a
        // unique declaration, keep its old value taken from everybody else while the new one was free
        await new ValKeyRepositoryDriver(entity, this.client, this.keyPrefix, this).saveIndexesOfRewrittenRows(changes, transaction);
    }
}

/**
 * Converts a value that valkey returned to a string.
 * @param value - The value to convert.
 * @returns The value as a string.
 */
function toStringValue(value: GlideString): string {
    return typeof value === 'string' ? value : Buffer.from(value).toString('utf8');
}