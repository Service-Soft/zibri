import { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Batch, GlideClient, GlideClientConfiguration, GlideReturnType, GlideString, PubSubMsg, Script } from '@valkey/valkey-glide';

import { scanValKeyKeys } from './scan-val-key-keys.function';
import { ValKeyBackupMode } from './val-key-backup-mode.model';
import { ValKeyClock } from './val-key-clock.model';
import { valKeyGlide } from './val-key-glide.function';
import { ValKeyLockKeyUtilities } from './val-key-lock-key.utilities';
import { type AuthServiceInterface } from '../../../auth/auth-service.interface';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { EntityMetadata } from '../../../entity/decorators/entity.decorator';
import { PropertyMetadata } from '../../../entity/decorators/property.decorator';
import { EntityMetadataMissingError } from '../../../entity/entity-metadata-missing.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { GlobalRegistry } from '../../../global/global-registry';
import { type HeldLease, type KeptGrant } from '../../../leases/held-lease.model';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { Newable } from '../../../types/newable.type';
import { OmitStrict } from '../../../types/omit-strict.type';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { Ms } from '../../../utilities/ms';
import { ObjectUtilities } from '../../../utilities/object.utilities';
import { PromiseUtilities } from '../../../utilities/promise.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { StoredRowChange, ValKeyRepositoryDriver } from '../../driver/val-key.repository-driver';
import { registerRepositoryProvidersFor } from '../../entity-ownership.function';
import { MigratedEntityUtilities } from '../../migration/migrated-entity.utilities';
import { MigrationRevertTarget } from '../../migration/migration-revert-target.model';
import { Migration } from '../../migration/migration.model';
import { recordKeyReconciliation, revertMigrationsAfter, runMigrations, runMigrationsAfterRestore } from '../../migration/run-migrations.function';
import { AddPropertyToEntityInput } from '../../models/add-property-to-entity-input.model';
import { ChangePropertyOfEntityInput } from '../../models/change-property-of-entity-input.model';
import { ConvertedValue } from '../../models/converted-value.model';
import { MergeEntityInput } from '../../models/merge-entity-input.model';
import { MigrationPropertyMetadata } from '../../models/migration-property-metadata.model';
import { RefusedValue } from '../../models/refused-value.model';
import { RemoveEntityInput } from '../../models/remove-entity-input.model';
import { RemovePropertyFromEntityInput } from '../../models/remove-property-from-entity-input.model';
import { RemoveRelationFromEntityInput } from '../../models/remove-relation-from-entity-input.model';
import { RenameEntityInput } from '../../models/rename-entity-input.model';
import { ResolvedPropertyConversion } from '../../models/resolved-property-conversion.model';
import { Repository, UNBOUNDED_FIND_ALL_LIMIT } from '../../repository/repository';
import { RepositoryClass } from '../../repository/repository-class.type';
import { RepositoryForUtilities } from '../../repository/repository-for.utilities';
import { RunInTransactionOptions } from '../../transaction/run-in-transaction-options.model';
import { TransactionDeadlockError } from '../../transaction/transaction-deadlock.error';
import { Transaction } from '../../transaction/transaction.model';
import { OpenTransactions } from '../../transaction/open-transactions.model';
import { TransactionUtilities } from '../../transaction/transaction.utilities';
import { ValKeyTransaction, ValKeyTransactionGrants } from '../../transaction/val-key-transaction.model';
import { ValueConversionUtilities } from '../../value-conversion.utilities';
import { DataSourceInitializationError } from '../data-source-initialization.error';
import { DataSourceInterface, DEFAULT_TRANSACTION_IDLE_TIMEOUT_IN_MS, RepositoryTypeForEntity, SCHEMA_LOCK_KEY, StartTransactionOptions } from '../data-source.interface';
import { DataSourceSubscription, PubSubDataSourceInterface } from '../pub-sub-data-source.interface';

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
 * Namespace for what a transaction is waiting for, by its token: the lock key it is queueing on.
 */
const LOCK_WAIT_KEY_PREFIX: string = 'zibri.lock-wait:';

/**
 * How long what a transaction waits for is kept without being written again.
 *
 * A few attempts long, since every attempt writes it again: a waiter that stopped - given up, ended,
 * gone with its instance - stops appearing in anybody's walk shortly after.
 */
const LOCK_WAIT_TTL_IN_MS: number = 500;

/**
 * How many holders a walk for a cycle follows at most, which bounds the script however long a chain
 * of waiting transactions grows.
 */
const MAX_LOCK_WAIT_HOPS: number = 64;

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

// Valkey has no server side equivalent of postgres' idle_in_transaction_session_timeout, so the
// transaction keeps transactionIdleTimeoutInMs itself

/**
 * How long to wait before subscribing again on a new client, once the one subscribed failed.
 */
const RESUBSCRIBE_DELAY_IN_MS: number = Ms.SECOND;

/**
 * How long to wait for the server to confirm a subscription.
 */
const SUBSCRIBE_TIMEOUT_IN_MS: number = 5 * Ms.SECOND;

/**
 * What one attempt at taking locks came to.
 */
type LockAttempt = {
    /**
     * How many of the locks it took, which are always the first ones.
     */
    taken: number,
    /**
     * The tokens of the callers waiting on each other in a cycle with this one, this one's first,
     * empty when it waits in none.
     */
    cycle: string[]
};

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
 * The scripts a backup is read with.
 */
type BackupScripts = {
    /**
     * Reads every key at one moment.
     */
    snapshot?: Script
};

/**
 * How many keys a backup read as a walk asks for at a time.
 */
const BACKUP_WALK_BATCH_SIZE: number = 250;

/**
 * Takes the given locks in the order they are given, and stops at the first one somebody else holds.
 * Answers how many it took, which are always the first ones, as the first entry of a list.
 *
 * Stopping rather than skipping is what keeps the order: a caller holds a prefix of its keys and
 * waits on the next one, exactly as it would taking them one by one, so two callers that sort their
 * keys the same way can never each hold what the other waits on. A key this caller already holds
 * counts as taken.
 *
 * That holds within one claim only. A transaction claims as it writes, so two of them writing two
 * rows in opposite orders each hold one and wait on the other. A caller naming the key of what it
 * waits for (ARGV[3]) has it written there while it waits and removed once it took everything; and
 * when it stops, the script follows the chain from the lock it stopped at - its holder, the lock that
 * holder waits for, that lock's holder - and answers the tokens on the way after the count when the
 * chain comes back to the caller. In one script, so the chain is read as it stands at one moment, and
 * a cycle it finds is one every transaction on it is waiting in. Each of them finds the same one.
 *
 * The keys a walk reads are only known as it goes, so they are not declared - which a single valkey
 * server allows, and which is why this data source connects to one rather than to a cluster.
 * @returns The script.
 */
function acquireLockScript(): Script {
    lockScripts.acquire ??= new (valKeyGlide().Script)(
        'for i = 1, #KEYS do '
        + 'local holder = redis.call("get", KEYS[i]) '
        + 'if not holder then redis.call("set", KEYS[i], ARGV[1], "PX", ARGV[2]) '
        + 'elseif holder ~= ARGV[1] then '
        + 'if ARGV[3] == "" then return { i - 1 } end '
        + 'redis.call("set", ARGV[3], KEYS[i], "PX", ARGV[4]) '
        + 'local cycle = { i - 1, ARGV[1] } '
        + 'local key = KEYS[i] '
        + `for hop = 1, ${MAX_LOCK_WAIT_HOPS} do `
        + 'local blocker = redis.call("get", key) '
        + 'if not blocker then return { i - 1 } end '
        + 'if blocker == ARGV[1] then return cycle end '
        + 'for j = 3, #cycle do if cycle[j] == blocker then return { i - 1 } end end '
        + 'cycle[#cycle + 1] = blocker '
        + 'key = redis.call("get", ARGV[5] .. blocker) '
        + 'if not key then return { i - 1 } end '
        + 'end '
        + 'return { i - 1 } '
        + 'end '
        + 'end '
        + 'if ARGV[3] ~= "" then redis.call("del", ARGV[3]) end '
        + 'return { #KEYS }'
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
 * The script a backup is read as a snapshot with, once it has been built - for the reason the lock
 * scripts are kept.
 */
const backupScripts: BackupScripts = {};

/**
 * Reads every key matching a pattern as it stands at one moment, and answers its name, what `DUMP`
 * makes of it and how long it has left to live, in turn.
 *
 * One script, because a script runs with nothing else in between: a transaction committed while it
 * runs is applied before it or after it, whole. The keys are only known once it runs, so they are
 * not declared, which a single valkey server allows.
 * @returns The script.
 */
function backupSnapshotScript(): Script {
    backupScripts.snapshot ??= new (valKeyGlide().Script)(
        'local res = {} '
        + 'for _, key in ipairs(redis.call("keys", ARGV[1])) do '
        + 'local payload = redis.call("dump", key) '
        // eslint-disable-next-line cspell/spellchecker
        + 'if payload then res[#res + 1] = key res[#res + 1] = payload res[#res + 1] = redis.call("pttl", key) end '
        + 'end return res'
    );
    return backupScripts.snapshot;
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

    abstract readonly repositories: RepositoryClass[];

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly migrations: Newable<Migration>[] = [];

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly maxMessageBytes: number | undefined = undefined;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly maxRowsWithoutLimit: number = UNBOUNDED_FIND_ALL_LIMIT;

    /**
     * How a backup of this data source is read. Has to be set when the data source is marked with
     * \@Backup.
     *
     * `'snapshot'` when a backup has to hold every transaction whole, and the server may pause for as
     * long as reading every key takes. `'walk'` when the server has to go on answering while a large
     * store is backed up.
     */
    readonly backupMode: ValKeyBackupMode | undefined;

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

    /**
     * How long a transaction may sit idle, in milliseconds, before it is rolled back. 0 for no limit.
     * A transaction that names its own `idleTimeoutInMs` when it starts takes that instead.
     */
    protected readonly transactionIdleTimeoutInMs: number = DEFAULT_TRANSACTION_IDLE_TIMEOUT_IN_MS;

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

    private readonly openTransactions: OpenTransactions = new OpenTransactions();

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

    private readonly builtRepositories: Map<Newable<BaseEntity>, Repository<BaseEntity>> = new Map();

    private clock: ValKeyClock | undefined;

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

        const client: GlideClient = await valKeyGlide().GlideClient.createClient({
            ...clientOptions,
            addresses: [{ host: host ?? 'localhost', port: port ?? 6379 }]
        });
        await this.validateServerIsStandalone(client);
        this.client = client;
        // read once here, so that the first call naming the time of the data source does not pay for it
        this.clock = new ValKeyClock(async () => {
            const [seconds, microseconds] = await client.time();
            return (Number(seconds) * 1000) + Math.floor(Number(microseconds) / 1000);
        });
        await this.clock.synchronize();

        // a command works on the schema as it is: one about migrations is what changes it
        if (GlobalRegistry.getAppData('runsCommand')) {
            return;
        }

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
     * Validates that the server is a single valkey server rather than a node of a cluster.
     * @param client - The client connected to it, closed when it is a node of a cluster.
     * @throws When the server runs in cluster mode.
     */
    private async validateServerIsStandalone(client: GlideClient): Promise<void> {
        // a node of a cluster answers only the keys of its own slots, and one write puts a row, its
        // id set, its index entries and its locks into one batch or one script, which a cluster
        // refuses across slots - starting anyway fails on the first write that spans two of them
        const info: string = await client.info([valKeyGlide().InfoOptions.Cluster]);
        if (/^cluster_enabled:1\s*$/m.test(info)) {
            client.close();
            throw new InternalError([
                `The valkey server of "${this.constructor.name}" runs in cluster mode.`,
                'A valkey data source connects to one server: a standalone one, or the primary of a primary with replicas.'
            ]);
        }
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async publish(channel: string, message: string): Promise<void> {
        if (!this.client) {
            throw new DataSourceInitializationError();
        }
        await this.client.publish(message, `${this.keyPrefix}:${channel}`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async subscribe(channel: string, onMessage: (message: string) => void): Promise<DataSourceSubscription> {
        const namespacedChannel: string = `${this.keyPrefix}:${channel}`;
        let subscriber: GlideClient | undefined = await this.resolveSubscriber(namespacedChannel);
        const closing: AbortController = new AbortController();

        // glide hands messages over by resolving a promise rather than by calling back, so reading
        // them is a loop that parks until the next one arrives
        const listen: () => Promise<void> = async () => {
            while (subscriber != undefined && !closing.signal.aborted) {
                try {
                    const msg: PubSubMsg = await subscriber.getPubSubMessage();
                    if (!closing.signal.aborted) {
                        onMessage(msg.message.toString());
                    }
                }
                catch (error) {
                    if (closing.signal.aborted) {
                        return;
                    }
                    // glide reconnects a dropped connection and subscribes it again by itself; what
                    // rejects here is a client that was closed, and a closed one never opens again.
                    // Returning used to leave this instance publishing to the others while hearing
                    // none of them (round-2 02 §S11, 03 §H18)
                    this.logger.error(new InternalError('a subscription to valkey failed, subscribing again', { cause: error }));
                    subscriber.close();
                    subscriber = await this.resolveSubscriberAgain(namespacedChannel, closing.signal);
                }
            }
        };
        void listen();

        return {
            unsubscribe: async () => {
                closing.abort();
                subscriber?.close();
                await Promise.resolve();
            }
        };
    }

    /**
     * Opens a client of its own subscribed to the given channel.
     * @param namespacedChannel - The channel, with the key prefix.
     * @returns The subscribed client.
     */
    private async resolveSubscriber(namespacedChannel: string): Promise<GlideClient> {
        // eslint-disable-next-line unusedImports/no-unused-vars
        const { host, port, keyPrefix, ...clientOptions } = this.fullOptions;

        // its own client: a connection that is subscribed is not a connection that should also be
        // answering commands, and the data source's one is busy doing exactly that
        const subscriber: GlideClient = await valKeyGlide().GlideClient.createClient({
            ...clientOptions,
            addresses: [{ host: host ?? 'localhost', port: port ?? 6379 }]
        });
        // the blocking form: the lazy one returns before the server confirmed, and a message published
        // in between never arrives
        await subscriber.subscribe([namespacedChannel], SUBSCRIBE_TIMEOUT_IN_MS);
        return subscriber;
    }

    /**
     * Subscribes to the given channel on a new client, once the one subscribed failed, retrying until
     * it works or the subscription is ended.
     *
     * What was published while there was none is not delivered: a channel is fan out, not a queue,
     * and whatever uses one keeps the state it is about somewhere it can read again.
     * @param namespacedChannel - The channel, with the key prefix.
     * @param closing - Aborted when the subscription is ended.
     * @returns The subscribed client, or undefined when the subscription was ended first.
     */
    private async resolveSubscriberAgain(namespacedChannel: string, closing: AbortSignal): Promise<GlideClient | undefined> {
        while (!closing.aborted) {
            try {
                await sleep(RESUBSCRIBE_DELAY_IN_MS, undefined, { signal: closing });
                const subscriber: GlideClient = await this.resolveSubscriber(namespacedChannel);
                if (closing.aborted) {
                    subscriber.close();
                    return undefined;
                }
                return subscriber;
            }
            catch (error) {
                if (!closing.aborted) {
                    this.logger.warn('could not subscribe to valkey again yet, retrying', { error });
                }
            }
        }
        return undefined;
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
     * @param endsDeadlocks - Whether this caller says what it waits for and may be ended to break a
     * cycle of callers waiting on each other: a transaction, which claims as it writes. A caller taking
     * all its locks in one go can never be part of one.
     * @throws TransactionDeadlockError when this caller is the one a cycle it waits in ends.
     * @throws When a wait ran out.
     */
    private async acquireLocks(
        client: GlideClient,
        keys: string[],
        token: string,
        holdInMs: number,
        timeoutInMs: number,
        held: Set<string>,
        endsDeadlocks: boolean
    ): Promise<void> {
        const lockKeys: string[] = [...new Set(keys)].sort().map(key => ValKeyLockKeyUtilities.getLockKey(key));
        const waitKey: string = endsDeadlocks ? `${LOCK_WAIT_KEY_PREFIX}${token}` : '';
        try {
            // one group after the other rather than together: taking them in order is the point, and
            // a later group taken while an earlier one waits would be holding keys out of it
            for (const group of PromiseUtilities.resolveChunks(lockKeys, LOCKS_PER_SCRIPT)) {
                await this.acquireLockGroup(client, group, token, holdInMs, timeoutInMs, held, waitKey);
            }
        }
        catch (error) {
            // no longer waiting, so no longer part of anybody's chain - it would lapse on its own a
            // moment later, and in that moment another walk could still follow it
            if (waitKey) {
                await client.del([waitKey]);
            }
            throw error;
        }
    }

    /**
     * Takes one group of locks, queueing until all of them are taken.
     * @param client - The client to take them through.
     * @param group - The namespaced keys, sorted.
     * @param token - The token that says whose they are.
     * @param holdInMs - How long a lock lives before it lapses.
     * @param timeoutInMs - How long to queue on one lock before giving up.
     * @param held - Where each lock goes as soon as it is taken.
     * @param waitKey - Where to say what this caller waits for, empty for a caller that does not.
     * @throws TransactionDeadlockError when this caller is the one a cycle it waits in ends.
     * @throws When a wait ran out.
     */
    private async acquireLockGroup(
        client: GlideClient,
        group: string[],
        token: string,
        holdInMs: number,
        timeoutInMs: number,
        held: Set<string>,
        waitKey: string
    ): Promise<void> {
        let waiting: string[] = group;
        let deadline: number = Date.now() + timeoutInMs;
        while (waiting.length) {
            const { taken, cycle }: LockAttempt = await this.attemptLocks(client, waiting, token, holdInMs, waitKey);
            for (const lockKey of waiting.slice(0, taken)) {
                held.add(lockKey);
            }
            waiting = waiting.slice(taken);
            if (!waiting.length) {
                return;
            }
            // the one of the cycle every transaction on it names, so exactly one of them ends and the
            // others go on once it has handed back what it held - the way postgres picks one
            if (cycle.length && [...cycle].sort().at(-1) === token) {
                throw new TransactionDeadlockError();
            }
            // the timeout is how long one lock may keep this waiting, as it was when they were taken
            // one call each, so any progress starts it again
            if (taken > 0) {
                deadline = Date.now() + timeoutInMs;
            }
            if (Date.now() > deadline) {
                throw new InternalError(
                    `Could not acquire the lock "${ValKeyLockKeyUtilities.getLockedKey(waiting[0] ?? '')}" within ${timeoutInMs}ms`
                    + ' - another instance is still holding it'
                );
            }
            await new Promise<void>(resolve => {
                setTimeout(resolve, LOCK_RETRY_IN_MS);
            });
        }
    }

    /**
     * Takes as many of the given locks as are free, in order, once.
     * @param client - The client to take them through.
     * @param lockKeys - The namespaced keys, sorted.
     * @param token - The token that says whose they are.
     * @param holdInMs - How long a lock lives before it lapses.
     * @param waitKey - Where to say what this caller waits for, empty for a caller that does not.
     * @returns How many it took, and the tokens of a cycle this caller waits in, if it waits in one.
     */
    private async attemptLocks(
        client: GlideClient,
        lockKeys: string[],
        token: string,
        holdInMs: number,
        waitKey: string
    ): Promise<LockAttempt> {
        // each lock carries a time to live, so an instance that dies holding it does not lock the
        // others out for good - it only delays them by that much
        const answer: unknown = await client.invokeScript(acquireLockScript(), {
            keys: lockKeys,
            args: [token, `${holdInMs}`, waitKey, `${LOCK_WAIT_TTL_IN_MS}`, LOCK_WAIT_KEY_PREFIX]
        });
        const parts: unknown[] = Array.isArray(answer) ? answer.map((part: unknown) => part) : [answer];
        const [taken, ...cycle]: unknown[] = parts;
        return { taken: Number(taken), cycle: cycle.map(member => String(member)) };
    }

    /**
     * Opens the grants of one transaction: a lock per key it writes, all under one token and kept
     * alive as one lease.
     *
     * One lease rather than one per key, because a transaction holds as many keys as it wrote rows.
     * Kept one by one, each would renew on a timer of its own and be released in a call of its own, so
     * a transaction writing a large batch would put that many requests on the client at once. A commit
     * hands them back in the script that applies its writes, so releasing them costs it no request.
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
                await this.acquireLocks(client, keys, token, holdInMs, timeoutInMs, held, true);
                // the transaction can end while this is queueing, because its idle timeout ends it
                // from a timer rather than from whoever is writing. What it held went back as it
                // ended, and what this took arrived after that - so it goes back on its own
                if (released) {
                    await this.releaseLocks(client, keys.map(key => ValKeyLockKeyUtilities.getLockKey(key)), token);
                }
            },
            resolveRelease: () => ({ token, lockKeys: [...held] }),
            release: async handedBack => {
                released = true;
                // gone already, so neither renewed nor released again: the lease's own release then
                // sends nothing when the commit handed back everything
                for (const lockKey of handedBack?.lockKeys ?? []) {
                    held.delete(lockKey);
                }
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
        const lockKey: string = ValKeyLockKeyUtilities.getLockKey(key);

        // unique to this acquisition, and checked by both the renewal and the release. Without it
        // neither can tell "my lock" from "a lock", and a holder whose key had already lapsed would
        // go on to free the one that replaced it.
        const token: string = UUIDUtilities.generate();
        await this.acquireLocks(client, [key], token, holdInMs, timeoutInMs, new Set(), false);

        return {
            name: key,
            renew: async () => await this.renewLocks(client, [lockKey], token, holdInMs, key),
            release: async () => await this.releaseLocks(client, [lockKey], token)
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async schemaLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
        const holdInMs: number = inject(ZIBRI_DI_TOKENS.SCHEMA_LOCK_HOLD_IN_MS);

        // acquired before the hold and not inside it: taking a grant can fail by running out of
        // patience, which is not something a grant that is already held can do. The hold then
        // follows the work rather than the work having to fit the hold - schemaLock takes an
        // arbitrary function and never says how long it may run for. Under the key prefix, since the
        // schema it guards is the one stored under it: an application with a prefix of its own on the
        // same server waited for every other one setting its schema up
        const lease: HeldLease = await this.acquireNativeGrant(
            `${this.keyPrefix}:${key}`,
            holdInMs,
            inject(ZIBRI_DI_TOKENS.SCHEMA_LOCK_TIMEOUT_IN_MS)
        );

        return await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).hold(lease, holdInMs, fn);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async shutDown(): Promise<void> {
        // before the client closes, which handing back their grants needs: a transaction nothing
        // ended kept its idle timer, which fired once the application was gone
        await this.openTransactions.rollBackAll(this.constructor.name, this.logger);
        this.client?.close();
        this.client = undefined;
        this.clock = undefined;
    }

    /**
     * The time on the clock of the valkey server, which every instance of the application compares by.
     * @returns The time.
     * @throws When the data source has not been initialized yet.
     */
    async resolveServerTime(): Promise<Date> {
        if (!this.clock) {
            throw new DataSourceInitializationError();
        }
        return await this.clock.resolveNow();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getRepository<T extends BaseEntity>(cls: Newable<T>): RepositoryTypeForEntity<T> {
        const client: GlideClient | undefined = this.client;
        if (!client) {
            throw new DataSourceInitializationError();
        }
        return RepositoryForUtilities.resolveEntityRepository(
            this,
            cls,
            this.builtRepositories,
            this.logger,
            this.authService,
            () => new ValKeyRepositoryDriver(cls, client, this.keyPrefix, this)
        );
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

        const transaction: ValKeyTransaction = new ValKeyTransaction(
            this.client,
            this.openTransactionGrants(this.client, holdInMs, timeoutInMs),
            options?.idleTimeoutInMs ?? this.transactionIdleTimeoutInMs,
            this.logger
        );
        this.openTransactions.add(transaction);
        return transaction;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async runInTransaction<R>(work: (transaction: Transaction) => Promise<R>, options: RunInTransactionOptions): Promise<R> {
        return await TransactionUtilities.runInTransaction(this, work, options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async runMigrations(): Promise<void> {
        await runMigrations(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revertMigrationsAfter(target: MigrationRevertTarget): Promise<void> {
        await revertMigrationsAfter(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger, target);
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

        await this.updateStoredRows(MigratedEntityUtilities.resolveEntityClass(input.entity, this.entities), input.transaction, row => {
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
        await this.updateStoredRows(MigratedEntityUtilities.resolveEntityClass(input.entity, this.entities), input.transaction, row => {
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removePropertyFromEntity<T extends BaseEntity>(input: RemovePropertyFromEntityInput<T>): Promise<void> {
        await this.updateStoredRows(
            MigratedEntityUtilities.resolveEntityClass(input.entity, this.entities),
            input.transaction,
            row => String(input.propertyKey) in row ? { remove: [String(input.propertyKey)] } : undefined
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async renameEntity<T extends BaseEntity>(input: RenameEntityInput<T>): Promise<void> {
        if (!this.client) {
            throw new DataSourceInitializationError();
        }
        await new ValKeyRepositoryDriver(
            MigratedEntityUtilities.resolveMovedEntityClass(input.entity, input.currentTableName, this.entities),
            this.client,
            this.keyPrefix,
            this
        ).moveStoredKeysFrom(input.currentTableName, input.transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async mergeEntity<T extends BaseEntity>(input: MergeEntityInput<T>): Promise<void> {
        if (!this.client) {
            throw new DataSourceInitializationError();
        }
        await new ValKeyRepositoryDriver(
            MigratedEntityUtilities.resolveMovedEntityClass(input.entity, input.currentTableName, this.entities),
            this.client,
            this.keyPrefix,
            this
        ).mergeStoredKeysFrom(input.currentTableName, input.transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createEntity(): Promise<void> {
        // valkey has no schema: an entity's keys come into being with its first row, and the keys of
        // its indexes and uniques with the reconciliation that follows the migrations
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removeRelationFromEntity<T extends BaseEntity>(input: RemoveRelationFromEntityInput<T>): Promise<void> {
        if (!this.client) {
            throw new DataSourceInitializationError();
        }
        // both sides, since each row keeps the related ids of its own side
        const sides: [Newable<BaseEntity>, string][] = [
            [MigratedEntityUtilities.resolveEntityClass(input.entity, this.entities), String(input.relation.name)],
            [MigratedEntityUtilities.resolveEntityClass(input.relation.target, this.entities), input.relation.inverseSide]
        ];
        for (const [entity, propertyKey] of sides) {
            await new ValKeyRepositoryDriver(entity, this.client, this.keyPrefix, this).removeJoinSets(propertyKey, input.transaction);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removeEntity<T extends BaseEntity>(input: RemoveEntityInput<T>): Promise<void> {
        if (!this.client) {
            throw new DataSourceInitializationError();
        }
        await new ValKeyRepositoryDriver(
            MigratedEntityUtilities.resolveEntityClass(input.entity, this.entities),
            this.client,
            this.keyPrefix,
            this
        ).removeStoredKeys(input.transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateBackupConfiguration(): void {
        // beyond this, a valkey backup only needs the connection that the data source already has
        if (this.backupMode == undefined) {
            throw new InternalError(
                'Invalid data source marked with @Backup: backupMode is not set.'
                + ' Set \'snapshot\' to read every key at one moment, pausing the server while it does,'
                + ' or \'walk\' to read them a batch at a time while the server goes on answering.'
            );
        }
    }

    /**
     * Creates a backup of every key of this data source, read the way {@link backupMode} says.
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
        const entries: AsyncGenerator<ValKeyBackupEntry> = this.backupMode === 'walk'
            ? this.walkBackupEntries(client, pattern)
            : this.snapshotBackupEntries(client, pattern);
        const isBackedUp: (key: string) => boolean = key => this.isBackedUp(key);

        return Readable.from((async function* generateBackupData(): AsyncGenerator<string> {
            for await (const entry of entries) {
                if (isBackedUp(entry.key)) {
                    yield `${JsonUtilities.stringify(entry)}\n`;
                }
            }
        })());
    }

    /**
     * Whether a key belongs to what a backup takes and a restore replaces, rather than to an entity
     * whose rows a restore keeps.
     * @param key - The key.
     * @returns False for a key of an entity that is not backed up.
     */
    private isBackedUp(key: string): boolean {
        return !this.entities
            .map(entity => MetadataUtilities.getEntityMetadata(entity))
            .some(metadata => metadata?.backedUp === false && key.startsWith(`${this.keyPrefix}:${metadata.tableName}:`));
    }

    /**
     * Reads every key of the backup at one moment.
     * @param client - The client to read with.
     * @param pattern - The keys to read.
     * @yields Each key, with what it holds and how long it has left to live.
     */
    private async* snapshotBackupEntries(client: GlideClient, pattern: string): AsyncGenerator<ValKeyBackupEntry> {
        const reply: GlideReturnType = await client.invokeScript(backupSnapshotScript(), {
            args: [pattern],
            decoder: valKeyGlide().Decoder.Bytes
        });
        const values: GlideReturnType[] = Array.isArray(reply) ? reply : [];
        for (let i: number = 0; i + 2 < values.length; i += 3) {
            const key: GlideReturnType | undefined = values[i];
            if (!Buffer.isBuffer(key)) {
                throw new InternalError('Could not back up a key: valkey answered no name of it.');
            }
            yield this.toBackupEntry(key.toString('utf8'), values[i + 1], values[i + 2]);
        }
    }

    /**
     * Reads the keys of the backup a batch at a time.
     * @param client - The client to read with.
     * @param pattern - The keys to read.
     * @yields Each key still there by the time its batch is read, with what it holds and how long it
     * has left to live.
     */
    private async* walkBackupEntries(client: GlideClient, pattern: string): AsyncGenerator<ValKeyBackupEntry> {
        for (const keys of PromiseUtilities.resolveChunks(await scanValKeyKeys(client, pattern), BACKUP_WALK_BATCH_SIZE)) {
            // one request per batch rather than two per key, without making it one moment
            const batch: Batch = new (valKeyGlide().Batch)(false);
            for (const key of keys) {
                batch.dump(key);
                // eslint-disable-next-line cspell/spellchecker
                batch.pttl(key);
            }
            const replies: GlideReturnType[] = await client.exec(batch, true, { decoder: valKeyGlide().Decoder.Bytes }) ?? [];
            for (const [i, key] of keys.entries()) {
                const payload: GlideReturnType | undefined = replies[i * 2];
                // deleted since it was found
                if (payload == undefined) {
                    continue;
                }
                yield this.toBackupEntry(key, payload, replies[(i * 2) + 1]);
            }
        }
    }

    /**
     * Turns what valkey answered about one key into an entry of the backup.
     * @param key - The key.
     * @param payload - What `DUMP` made of it.
     * @param ttlMs - What `PTTL` answered for it.
     * @returns The entry.
     * @throws When valkey answered something else.
     */
    private toBackupEntry(key: string, payload: GlideReturnType | undefined, ttlMs: GlideReturnType | undefined): ValKeyBackupEntry {
        if (!Buffer.isBuffer(payload) || typeof ttlMs !== 'number') {
            throw new InternalError(`Could not back up the key "${key}": valkey answered no dump of it.`);
        }
        return { key, ttlMs: ttlMs > 0 ? ttlMs : 0, payload: payload.toString('base64') };
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
     *
     * Once swapped in, what the backup holds is brought in line with this version of the app: every
     * migration it has not recorded runs, and the indexes and uniques are built as the entities
     * declare them. A backup taken by a newer version of the app is refused.
     * @param backupData - The backup data to restore.
     * @throws When the data source has not been initialized yet, or when the backup could not be
     * read - in which case nothing has been changed. When the backup was taken by a newer version of
     * the app, when a migration fails, or when the restored rows break a declared unique or check.
     */
    async restoreBackup(backupData: Readable): Promise<void> {
        const client: GlideClient | undefined = this.client;
        if (!client) {
            throw new DataSourceInitializationError();
        }

        const staged: string[] = await this.stageBackup(client, backupData);
        // staged keys live under this prefix too, so they have to be kept out of what is swept away, and
        // so do the keys of the entities whose rows the restore keeps
        const existingKeys: string[] = (await scanValKeyKeys(client, `${this.keyPrefix}:*`))
            .filter(k => !k.startsWith(this.stagingPrefix()) && this.isBackedUp(k));

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

        // a row and what is kept about it are only as consistent as the backup was taken, and a walk
        // takes them at different moments. Under the schema lock, so that no instance starting up
        // reconciles or migrates them at the same time. Not around the swap: the lock is a key under
        // the prefix, which the swap deletes
        await this.schemaLock(SCHEMA_LOCK_KEY, async () => {
            let changed: boolean = false;
            for (const entity of this.entities) {
                changed = await new ValKeyRepositoryDriver(entity, client, this.keyPrefix, this).rebuildStoredKeys() || changed;
            }
            // after the keys are rebuilt, since the migrations read through them. A backup of an
            // older release left as it was kept the values the newer one migrated away from
            await runMigrationsAfterRestore(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger);
            if (await this.reconcileKeys() || changed) {
                await recordKeyReconciliation(this.constructor as Newable<DataSourceInterface>);
            }
        });
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
        const entry: ValKeyBackupEntry = JsonUtilities.parse(line);
        // a backup taken before the entity was left out still holds its keys
        if (!this.isBackedUp(entry.key)) {
            return [];
        }
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
        if (!transaction.isStartedOn(this.client)) {
            throw new InternalError('The provided transaction belongs to another valkey data source: this one did not start it.');
        }

        const entityMetadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entity);
        if (!entityMetadata) {
            throw new EntityMetadataMissingError(entity);
        }

        const idsKey: string = `${this.keyPrefix}:${entityMetadata.tableName}:ids`;
        const changes: StoredRowChange[] = [];
        // eslint-disable-next-line cspell/spellchecker
        const storedIds: string[] = [...await this.client.smembers(idsKey)].map(id => toStringValue(id));
        // with the ids the transaction holds besides, which are the rows the migration created or
        // moved here by renaming the entity, before this step
        for (const id of transaction.resolveSetMembers(idsKey, storedIds)) {
            const key: string = `${this.keyPrefix}:${entityMetadata.tableName}:${id}`;
            const stored: Record<string, string> = Object.fromEntries(
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