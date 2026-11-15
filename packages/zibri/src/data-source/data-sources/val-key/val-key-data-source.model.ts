import { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Batch, Decoder, GlideClient, GlideClientConfiguration, GlideReturnType, GlideString, PubSubMsg, Script } from '@valkey/valkey-glide';

import { ValKeyBackupMode } from './val-key-backup-mode.model';
import { ValKeyBackupUniqueCheck, ValKeyCheckedEntity } from './val-key-backup-unique-check.model';
import { ValKeyClock } from './val-key-clock.model';
import { VAL_KEY_ASIDE_SEGMENT, VAL_KEY_BACKUP_SNAPSHOT_SEGMENT, ValKeyCopyOnWriteUtilities, ValKeyReadView } from './val-key-copy-on-write.utilities';
import { valKeyGlide } from './val-key-glide.function';
import { ValKeyLockKeyUtilities } from './val-key-lock-key.utilities';
import { ValKeyRestoreMode } from './val-key-restore-mode.model';
import { ValKeyScanUtilities } from './val-key-scan.utilities';
import { type AuthServiceInterface } from '../../../auth/auth-service.interface';
import { type BackupDataOptions } from '../../../backup/backup-data-options.model';
import { type BackupEntity } from '../../../backup/backup-entity.model';
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
import { Bytes } from '../../../utilities/bytes';
import { type FsPath } from '../../../utilities/fs.utilities';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { Ms } from '../../../utilities/ms';
import { ObjectUtilities } from '../../../utilities/object.utilities';
import { PromiseUtilities } from '../../../utilities/promise.utilities';
import { StagedSortUtilities } from '../../../utilities/staged-sort.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { StoredRowChange, ValKeyRepositoryDriver } from '../../driver/val-key.repository-driver';
import { registerRepositoryProvidersFor } from '../../entity-ownership.function';
import { MigratedEntityUtilities } from '../../migration/migrated-entity.utilities';
import { MigrationEntity } from '../../migration/migration-entity.model';
import { MigrationRevertTarget } from '../../migration/migration-revert-target.model';
import { Migration } from '../../migration/migration.model';
import { type RecordedMigration } from '../../migration/recorded-migration.model';
import { isMigratedAsOf, recordKeyReconciliation, revertMigrationsAfter, runMigrations, runMigrationsAfterRestore } from '../../migration/run-migrations.function';
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
import { OpenTransactions } from '../../transaction/open-transactions.model';
import { RunInTransactionOptions } from '../../transaction/run-in-transaction-options.model';
import { TransactionDeadlockError } from '../../transaction/transaction-deadlock.error';
import { Transaction } from '../../transaction/transaction.model';
import { TransactionUtilities } from '../../transaction/transaction.utilities';
import { ValKeyReadViewHandle, ValKeyTransaction, ValKeyTransactionGrants } from '../../transaction/val-key-transaction.model';
import { ValueConversionUtilities } from '../../value-conversion.utilities';
import { DataSourceInitializationError } from '../data-source-initialization.error';
import { DataSourceInterface, DEFAULT_TRANSACTION_IDLE_TIMEOUT_IN_MS, IsolationLevel, RepositoryTypeForEntity, SCHEMA_LOCK_KEY, StartTransactionOptions } from '../data-source.interface';
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
 * An entry of a valkey backup holding a key whole.
 */
type ValKeyDumpedEntry = {
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
 * An entry of a valkey backup holding a page of the members of a set too large to be held whole, one of
 * several entries of the same key.
 */
type ValKeySetMembersEntry = {
    /**
     * The key of the set.
     */
    key: string,
    /**
     * The remaining time to live in milliseconds, 0 when the key does not expire.
     */
    ttlMs: number,
    /**
     * What it is.
     */
    kind: 'set-members',
    /**
     * The members, each base64 encoded.
     */
    members: string[]
};

/**
 * A single entry of a valkey backup.
 */
type ValKeyBackupEntry = ValKeyDumpedEntry | ValKeySetMembersEntry;

/**
 * What a walk has to know of a key before it reads it.
 */
type ValKeyKeyShape = {
    /**
     * Whether it is a set too large to be read whole.
     */
    paged: boolean,
    /**
     * What `PTTL` answered for it.
     */
    ttlMs: number
};

/**
 * A walk copying on write: what each write copies the old value of a key under for it, and the copies of
 * the sets too large to be read whole it reads, held aside under its run.
 */
type CopyOnWriteRun = {
    /**
     * What the walk reads through: what writes made of the keys they wrote since it began.
     */
    view: ValKeyReadView,
    /**
     * What the copies of the sets read in pages are named under, followed by the key.
     */
    setPrefix: string,
    /**
     * The set of the copies the run made, each listed as it was made.
     */
    copiesKey: string,
    /**
     * The heartbeat of the run.
     */
    heartbeat: AsideHeartbeat,
    /**
     * Stops writes copying for the run, and deletes what it held aside.
     */
    stop: () => Promise<void>
};

/**
 * The heartbeat of a snapshot or a restore holding keys aside, renewed while it runs.
 */
type AsideHeartbeat = {
    /**
     * The key it lives under.
     */
    key: string,
    /**
     * Checks that it never lapsed, which is what keeps another run from deleting what this one holds.
     * @param held - What the run holds aside, as the error names it.
     * @throws When it lapsed.
     */
    validateAlive: (held: string) => Promise<void>,
    /**
     * Stops renewing it, and deletes it and its entry in the list of runs.
     */
    stop: () => Promise<void>
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
 * Namespace a backup holds keys aside under while it reads: see {@link VAL_KEY_BACKUP_SNAPSHOT_SEGMENT}.
 */
const BACKUP_SNAPSHOT_SEGMENT: string = VAL_KEY_BACKUP_SNAPSHOT_SEGMENT;

/**
 * Namespace of the heartbeats of the runs that hold keys aside, and of the list of them, which is how what
 * one left behind when its process died is found and deleted: see {@link VAL_KEY_ASIDE_SEGMENT}.
 */
const ASIDE_SEGMENT: string = VAL_KEY_ASIDE_SEGMENT;

/**
 * How long the heartbeat of a run holding keys aside lives without being renewed.
 *
 * Beyond the longest a script of a backup or a restore is waited for: the server answers nothing
 * while one runs, a renewal included, and time stands still for a script, so a heartbeat written
 * before it has its whole life left once it is done.
 */
const ASIDE_HEARTBEAT_TTL_IN_MS: number = 15 * Ms.MINUTE;

/**
 * How often the heartbeat of a run holding keys aside is renewed.
 */
const ASIDE_HEARTBEAT_RENEWAL_IN_MS: number = Ms.MINUTE;

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
 * How many keys a restore writes in one request. A backup reads them a page of the scan at a time.
 */
const RESTORE_BATCH_SIZE: number = 250;

/**
 * How many keys a backup reads in one request, once their names are sorted.
 */
const BACKUP_READ_KEYS: number = 250;

/**
 * How many members a set holds at most to be backed up whole, as one `DUMP`. A larger one, such as the
 * ids of a table, is read a page at a time: whole, it was held three times over, as the dump, its base64
 * and its line, about 12 MiB at 100 000 rows.
 */
const SET_DUMPED_MEMBERS: number = 1000;

/**
 * How many members one page of a set read in pages asks for, which bounds what a line of the backup and a
 * batch of a restore hold.
 */
const SET_PAGE_MEMBERS: number = 250;

/**
 * Copies the key ARGV[1] to ARGV[2], listed in the copies of the walk ARGV[5], unless the copy would need
 * more memory than the ARGV[3] bytes the server has free (negative when it has no limit it knows of), or a
 * write copied it to ARGV[4] already for the walk copying it. Answers `{ 1 }` once copied, `{ 0 }` when the
 * key is gone, `{ 2 }` when the copy of the write is there to read, or `{ -1, needed }` with nothing copied.
 *
 * In one script for the reason the snapshot's copy is one: no write between the check and the copy makes
 * it wrong, and under an eviction policy a copy past the limit would have the server evict the
 * application's own keys to make room for it.
 */
const SET_COPY_SCRIPT: string = 'if redis.call("exists", ARGV[4]) == 1 then return { 2 } end '
    + 'local needed = redis.call("memory", "usage", ARGV[1], "samples", "0") '
    + 'if not needed then return { 0 } end '
    + 'local free = tonumber(ARGV[3]) '
    + 'if free >= 0 and needed + #ARGV[2] > free then return { -1, needed } end '
    + 'redis.call("copy", ARGV[1], ARGV[2]) '
    + 'redis.call("sadd", ARGV[5], ARGV[2]) '
    + 'return { 1 }';

/**
 * Reads keys as a walk copying on write reads them, each as it was when the walk began: the copy a write
 * made of it where there is one, nothing where a write noted it as absent, a set whose members a write
 * changed in pages, through what was noted of them, and otherwise the key, which no write changed since.
 * ARGV[1] is what the copies are named under, ARGV[2] the set of the keys noted as absent, ARGV[3] the most
 * members a set read whole holds, ARGV[4] and ARGV[5] what the members added and removed since are noted
 * under, ARGV[6] the key naming a key a write could not hold for the walk, and each key follows with "1"
 * when its fields are read beside, for the check of the uniques. Answers for each key `{ 0 }` when there is
 * none, `{ 2, source, ttl }` for a set read in pages from the source, or `{ 1, dump, ttl, fields }`, and
 * `{ { -1, key } }` alone once a write could not hold a key for the walk.
 *
 * One script, so that no write lands between finding no copy and reading the key.
 */
const COPY_ON_WRITE_READ_SCRIPT: string = 'if redis.call("exists", ARGV[6]) == 1 then return { { -1, redis.call("get", ARGV[6]) } } end '
    + 'local res = {} '
    + 'for i = 7, #ARGV, 2 do '
    + 'local key = ARGV[i] '
    + 'local source = ARGV[1] .. key '
    + 'if redis.call("exists", source) == 0 then '
    + 'if redis.call("sismember", ARGV[2], key) == 1 then source = nil else source = key end '
    + 'end '
    + 'if source == key and (redis.call("exists", ARGV[4] .. key) == 1 or redis.call("exists", ARGV[5] .. key) == 1) then '
    + 'res[#res + 1] = { 2, key, redis.call("pttl", key) } '
    + 'elseif source == nil or redis.call("exists", source) == 0 then res[#res + 1] = { 0 } '
    + 'else '
    + 'local kind = redis.call("type", source)["ok"] '
    + 'local ttl = redis.call("pttl", source) '
    + 'if kind == "set" and redis.call("scard", source) > tonumber(ARGV[3]) then res[#res + 1] = { 2, source, ttl } '
    + 'else '
    + 'local fields = {} '
    + 'if ARGV[i + 1] == "1" and kind == "hash" then fields = redis.call("hgetall", source) end '
    + 'res[#res + 1] = { 1, redis.call("dump", source), ttl, fields } '
    + 'end '
    + 'end '
    + 'end '
    + 'return res';

/**
 * How long a client waits for a script of a backup or a restore to answer.
 *
 * Far beyond the request timeout, which a script copying or swapping every key of a large store
 * outlasts: the server goes on running it all the same, so a client giving up would report a restore
 * as failed that swapped in. The server answers nothing else while one runs, so a script anywhere
 * near this has stalled the whole application long before.
 */
const BACKUP_SCRIPT_TIMEOUT_IN_MS: number = 10 * Ms.MINUTE;

/**
 * Copies every key matching ARGV[1] under the prefix ARGV[2], at one moment, unless the copies would
 * need more memory than the ARGV[3] bytes the server has free (negative when it has no limit it
 * knows of). Keys starting with any of ARGV[4] onwards are left out. Answers `{ 1, copied }`, or
 * `{ 0, needed }` with nothing copied.
 *
 * One script, because a script runs with nothing else in between: a transaction committed while it
 * runs is copied before it or after it, whole. Copying rather than dumping is what keeps the pause
 * short and the backup out of this process's memory: nothing is serialized or sent, and the copies
 * are read afterwards a batch at a time. The memory is measured in the same script, so no write
 * between the check and the copy can make it wrong: under an eviction policy, copies past the limit
 * would have the server evict the application's own keys to make room for them. `SAMPLES 0` counts
 * every element of a key rather than estimating from a few, and each copy's name is longer by the
 * prefix. The keys are only known once it runs, so they are not declared, which a single valkey
 * server allows.
 */
const SNAPSHOT_COPY_SCRIPT: string = 'local taken = {} local needed = 0 '
    + 'for _, key in ipairs(redis.call("keys", ARGV[1])) do '
    + 'local left = false '
    + 'for i = 4, #ARGV do if string.sub(key, 1, #ARGV[i]) == ARGV[i] then left = true break end end '
    + 'if not left then '
    + 'taken[#taken + 1] = key '
    + 'needed = needed + (redis.call("memory", "usage", key, "samples", "0") or 0) + #ARGV[2] '
    + 'end '
    + 'end '
    + 'local free = tonumber(ARGV[3]) '
    + 'if free >= 0 and needed > free then return { 0, needed } end '
    + 'for _, key in ipairs(taken) do redis.call("copy", key, ARGV[2] .. key) end '
    + 'return { 1, #taken }';

/**
 * Deletes every key matching ARGV[1], except those starting with ARGV[2] or any of ARGV[4] onwards,
 * and renames each key starting with ARGV[2] to what follows the prefix. Answers how many keys it
 * deleted and renamed, or -1, changing nothing, when the heartbeat ARGV[3] of the restore is gone:
 * its staged keys may have been swept as left behind meanwhile.
 *
 * One script for the reason the snapshot is one: no reader sees half of the old state and half of
 * the new one. Built on the server rather than sent as a transaction of a delete and a rename per
 * key, which had this process hold every key's name and a command for each. Deleting before renaming,
 * since a staged key takes the name of one that is deleted. Time stands still while a script runs, so
 * no staged key expires between being listed and being renamed.
 */
const RESTORE_SWAP_SCRIPT: string = 'if redis.call("exists", ARGV[3]) == 0 then return -1 end '
    + 'local staged = {} local old = {} '
    + 'for _, key in ipairs(redis.call("keys", ARGV[1])) do '
    + 'if string.sub(key, 1, #ARGV[2]) == ARGV[2] then staged[#staged + 1] = key '
    + 'else '
    + 'local kept = false '
    + 'for i = 4, #ARGV do if string.sub(key, 1, #ARGV[i]) == ARGV[i] then kept = true break end end '
    + 'if not kept then old[#old + 1] = key end '
    + 'end '
    + 'end '
    + 'for _, key in ipairs(old) do redis.call("del", key) end '
    + 'for _, key in ipairs(staged) do redis.call("rename", key, string.sub(key, #ARGV[2] + 1)) end '
    + 'return #old + #staged';

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
     * `'snapshot'` when the application writes to the server past the data source, the server may pause
     * for as long as copying every key takes, and has the memory for that copy. `'walk'` when the server
     * has to go on answering while a large store is backed up, or has no memory to spare.
     */
    readonly backupMode: ValKeyBackupMode | undefined;

    /**
     * How a restore of this data source writes the backup. Has to be set when the data source is marked
     * with \@Backup.
     *
     * `'staged'` when no reader may see part of the backup and the server has the memory to hold the
     * backup beside what it replaces. `'direct'` when the server has no memory to spare, or has to go on
     * answering while a large store is restored.
     */
    readonly restoreMode: ValKeyRestoreMode | undefined;

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
        const { host = 'localhost', port = 6379, keyPrefix, ...clientOptions } = this.fullOptions;
        await this.validateOptions(this.fullOptions);

        for (const entityClass of this.entities) {
            this.validateEntity(entityClass);
        }
        registerRepositoryProvidersFor(this.constructor as Newable<DataSourceInterface>, this);

        const client: GlideClient = await valKeyGlide().GlideClient.createClient({
            ...clientOptions,
            addresses: [{ host, port }]
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
                    // none of them
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
        const { host = 'localhost', port = 6379, keyPrefix, ...clientOptions } = this.fullOptions;

        // its own client: a connection that is subscribed is not a connection that should also be
        // answering commands, and the data source's one is busy doing exactly that
        const subscriber: GlideClient = await valKeyGlide().GlideClient.createClient({
            ...clientOptions,
            addresses: [{ host, port }]
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
     * @param isHandingBack - Whether the holder is handing the locks back itself by now, so that a
     * renewal finding them gone found them released rather than lost.
     */
    private async renewLocks(
        client: GlideClient,
        lockKeys: string[],
        token: string,
        holdInMs: number,
        name: string,
        isHandingBack: () => boolean = () => false
    ): Promise<void> {
        try {
            const renewed: number[] = await PromiseUtilities.allChunked(
                PromiseUtilities.resolveChunks(lockKeys, LOCKS_PER_SCRIPT),
                async keys => Number(await client.invokeScript(renewLockScript(), { keys, args: [token, `${holdInMs}`] }))
            );
            const lost: number = lockKeys.length - renewed.reduce((sum, n) => sum + n, 0);
            if (lost > 0 && !isHandingBack()) {
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
        // that replaced it
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
        // set as the commit sends its writes, which hand the locks back in the same script. Renewal
        // goes on until then, so the locks outlive the wait for the script - and a renewal answered
        // after it finds them gone because the commit released them, which is no loss. Reported as
        // one, a commit of a large batch warned that every lock it held had been lost
        let handingBack: boolean = false;
        const lease: HeldLease = {
            name: `transaction ${token}`,
            renew: async () => await this.renewLocks(client, [...held], token, holdInMs, `transaction ${token}`, () => handingBack),
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
            resolveRelease: () => {
                handingBack = true;
                return { token, lockKeys: [...held] };
            },
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
        const client: GlideClient = this.client;
        if (options?.isolationLevel === IsolationLevel.SERIALIZABLE) {
            this.logger.warn(
                `The data source "${this.constructor.name}" does not support the isolation level "${IsolationLevel.SERIALIZABLE}",`
                + ` the transaction runs as "${IsolationLevel.REPEATABLE_READ}".`
            );
        }
        // read as of its first read, through the copies writes make from then on
        const readsAsOfOneMoment: boolean = options?.isolationLevel === IsolationLevel.REPEATABLE_READ
            || options?.isolationLevel === IsolationLevel.SERIALIZABLE;

        const holdInMs: number = inject(ZIBRI_DI_TOKENS.VAL_KEY_TRANSACTION_LOCK_HOLD_IN_MS);
        const timeoutInMs: number = inject(ZIBRI_DI_TOKENS.VAL_KEY_TRANSACTION_LOCK_TIMEOUT_IN_MS);

        const transaction: ValKeyTransaction = new ValKeyTransaction(
            this.client,
            this.keyPrefix,
            this.openTransactionGrants(this.client, holdInMs, timeoutInMs),
            options?.idleTimeoutInMs ?? this.transactionIdleTimeoutInMs,
            this.logger,
            readsAsOfOneMoment ? async () => await this.openReadView(client) : undefined
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
            : null;

        await this.updateStoredRows(MigratedEntityUtilities.resolveEntityClass(input.entity, this.entities), input.transaction, row => {
            return name in row ? undefined : { values: { [name]: JsonUtilities.stringify(value) } };
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

    // void or a promise rather than async: a subclass of 3.0 overrides it returning void, and calls it without
    // awaiting it. The memory check it returns logs its own failure, so such a call leaves no rejection behind.
    // TODO 4.0: Promise<void>
    // eslint-disable-next-line jsdoc/require-jsdoc
    validateBackupConfiguration(): void | Promise<void> {
        // beyond this, a valkey backup only needs the connection that the data source already has
        if (this.backupMode == undefined) {
            throw new InternalError(
                'Invalid data source marked with @Backup: backupMode is not set.'
                + ' Set \'snapshot\' to read every key at one moment, pausing the server while it does,'
                + ' or \'walk\' to read them a batch at a time while the server goes on answering.'
            );
        }
        // TODO 4.0: refuse to start without it, as without backupMode
        if (this.restoreMode == undefined) {
            this.logger.warn(
                `The data source "${this.constructor.name}" is marked with @Backup and sets no restoreMode, so a restore writes`
                + ' the backup beside what is stored and swaps it in, as \'staged\' does. Set \'staged\', or \'direct\' to write it'
                + ' in place of what is stored while the server goes on answering. It is required from 4.0.'
            );
        }
        const client: GlideClient | undefined = this.client;
        if (!client) {
            throw new DataSourceInitializationError();
        }
        return this.validateBackupMemorySettings(client);
    }

    /**
     * Warns when the server is set up so that a backup or a restore can take more memory than it is given.
     *
     * A backup copies keys only when they fit into what the server has free, which it reads from `maxmemory`,
     * and a staged restore that does not fit fails and changes nothing only when the server refuses the
     * write rather than evicting a key for it. A server that does not answer is warned about as well, and fails
     * nothing: the settings only decide what is warned about.
     * @param client - The client connected to the server.
     */
    private async validateBackupMemorySettings(client: GlideClient): Promise<void> {
        let info: string;
        try {
            // read from INFO rather than CONFIG, which managed services often refuse
            info = await client.info([valKeyGlide().InfoOptions.Memory]);
        }
        catch (error) {
            this.logger.warn(
                `Could not read the memory settings of the valkey server of "${this.constructor.name}", which a backup and a`
                + ` restore depend on: ${error instanceof Error ? error.message : String(error)}`
            );
            return;
        }
        // TODO 4.0: refuse to start without maxmemory, as for an evicting policy
        if (!Number(/^maxmemory:(\d+)\s*$/m.exec(info)?.[1] ?? 0)) {
            this.logger.warn(
                `The valkey server of "${this.constructor.name}" sets no maxmemory, so a backup counts the memory of its machine as`
                + ' what the server may use. In a container, that is the memory of the host rather than the limit of the container,'
                + ' and a copy past that limit has the container killed. Set maxmemory. It is required from 4.0.'
            );
        }
        // TODO 4.0: refuse to start under a policy that evicts
        const policy: string | undefined = /^maxmemory_policy:(\S+)\s*$/m.exec(info)?.[1];
        if (policy != undefined && policy !== 'noeviction') {
            this.logger.warn(
                `The valkey server of "${this.constructor.name}" evicts keys once it is full, by the maxmemory-policy ${policy}:`
                + ' it evicts rows of the entities to make room for a write, and keys of a backup a staged restore writes'
                + ' before it swaps them in. Set maxmemory-policy to noeviction. It is required from 4.0.'
            );
        }
    }

    /**
     * How a restore writes the backup: as {@link restoreMode} says, and as `'staged'` without one.
     * @returns The mode.
     */
    private resolveRestoreMode(): ValKeyRestoreMode {
        // TODO 4.0: restoreMode is required, so this is it
        return this.restoreMode ?? 'staged';
    }

    /**
     * Creates a backup of every key of this data source, read the way {@link backupMode} says, in the
     * order of their names.
     *
     * Each line of the returned stream is one json encoded key, as produced by the DUMP command, or a page
     * of the members of a large set.
     * @param backup - The backup being taken.
     * @param options - What the backup does with the data, and where the names of the keys are sorted. Sorted in
     * `ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER` without it.
     * @returns A readable stream of the backup data.
     * @throws When the data source has not been initialized yet.
     */
    // both optional, as 3.0 took none. TODO 4.0: both required, as BackupResourceInterface has them
    createBackupData(backup?: BackupEntity, options?: BackupDataOptions): Readable {
        const client: GlideClient | undefined = this.client;
        if (!client) {
            throw new DataSourceInitializationError();
        }
        const stagingFolder: FsPath = options?.stagingFolder ?? inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER);
        const entries: AsyncGenerator<ValKeyBackupEntry> = this.backupMode === 'walk'
            ? this.walkBackupEntries(client, undefined, stagingFolder)
            : this.snapshotBackupEntries(client, stagingFolder);
        // once rather than per key, since they are read from the metadata of every entity
        const unbackedPrefixes: string[] = this.resolveUnbackedKeyPrefixes();
        const isBackedUp: (key: string) => boolean = key => this.isBackedUp(key, unbackedPrefixes);

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
     * @param unbackedPrefixes - What {@link resolveUnbackedKeyPrefixes} answered.
     * @returns False for a key of an entity that is not backed up, or one held aside.
     */
    private isBackedUp(key: string, unbackedPrefixes: string[]): boolean {
        return !unbackedPrefixes.some(prefix => key.startsWith(prefix));
    }

    /**
     * The prefixes of the keys a backup leaves out and a restore leaves in place: what a backup or a
     * restore that is running holds aside, and the rows of the entities that are not backed up.
     * @returns The prefixes, each including its trailing separator.
     */
    private resolveUnbackedKeyPrefixes(): string[] {
        return [
            // a backup taken while a restore stages, or one that was stopped part way left behind,
            // would otherwise take those keys, and a restore of it stage them a second level deep
            `${this.keyPrefix}:${RESTORE_STAGING_SEGMENT}:`,
            `${this.keyPrefix}:${BACKUP_SNAPSHOT_SEGMENT}:`,
            `${this.keyPrefix}:${ASIDE_SEGMENT}:`,
            ...this.entities
                .map(entity => MetadataUtilities.getEntityMetadata(entity))
                .flatMap(metadata => metadata?.backedUp === false ? [`${this.keyPrefix}:${metadata.tableName}:`] : [])
        ];
    }

    /**
     * Copies every key of the backup at one moment, and reads the copies.
     * @param client - The client to read with.
     * @param stagingFolder - Where the names of the copies are sorted, on this instance's disk.
     * @yields Each key as it was copied, with what it holds and how long it has left to live.
     * @throws When the server has less memory free than the copies need.
     */
    private async* snapshotBackupEntries(client: GlideClient, stagingFolder: FsPath): AsyncGenerator<ValKeyBackupEntry> {
        // one of its own per backup, so that two taken at once each read only their own copies
        const runId: string = UUIDUtilities.generate();
        const copyPrefix: string = `${this.keyPrefix}:${BACKUP_SNAPSHOT_SEGMENT}:${runId}:`;
        await this.sweepLeftAside(client);
        const freeBytes: number | undefined = await this.resolveFreeMemoryBytes(client);
        const heartbeat: AsideHeartbeat = await this.startAsideHeartbeat(client, runId);
        let read: boolean = false;
        try {
            const reply: GlideReturnType | undefined = await this.invokeBackupScript(
                client,
                SNAPSHOT_COPY_SCRIPT,
                [`${this.keyPrefix}:*`, copyPrefix, `${freeBytes ?? -1}`, ...this.resolveUnbackedKeyPrefixes()]
            );
            const answer: GlideReturnType[] = Array.isArray(reply) ? reply : [];
            if (answer[0] !== 1) {
                throw new InternalError([
                    `The backup of "${this.constructor.name}" could not be taken as a snapshot.`,
                    `Valkey needs to have ${this.formatMebibytes(Number(answer[1]))} free to copy the keys into,`
                    + ` and has ${this.formatMebibytes(freeBytes ?? 0)}.`,
                    'Raise its maxmemory, or set backupMode to \'walk\'.'
                ]);
            }
            yield* this.walkBackupEntries(client, copyPrefix, stagingFolder);
            // a copy that is gone reads as a key deleted since the snapshot, so copies swept away by
            // another run, which took this one for dead, would make a backup that silently lacks them.
            // The heartbeat there at the end was there throughout, since nothing writes it back
            await heartbeat.validateAlive('the copies of the snapshot');
            read = true;
        }
        finally {
            // only when the backup failed or was stopped part way: read through, every copy was let go
            // of as it was read. A script that failed while copying leaves the copies it made
            if (!read) {
                await this.deleteKeys(client, `${copyPrefix}*`);
            }
            await heartbeat.stop();
        }
    }

    /**
     * Starts the heartbeat of a snapshot or a restore holding keys aside under its id, renewed until
     * it is stopped.
     * @param client - The client to write it with.
     * @param runId - The id the keys are held aside under.
     * @returns The heartbeat.
     */
    private async startAsideHeartbeat(client: GlideClient, runId: string): Promise<AsideHeartbeat> {
        const heartbeatKey: string = this.resolveAsideHeartbeatKey(runId);
        const batch: Batch = new (valKeyGlide().Batch)(true);
        batch.set(heartbeatKey, runId, { expiry: { type: valKeyGlide().TimeUnit.Milliseconds, count: ASIDE_HEARTBEAT_TTL_IN_MS } });
        batch.sadd(this.resolveAsideRunsKey(), [runId]);
        await client.exec(batch, true);
        const renewal: NodeJS.Timeout = setInterval(
            () => void this.renewAsideHeartbeat(client, heartbeatKey),
            ASIDE_HEARTBEAT_RENEWAL_IN_MS
        );
        // so a backup in flight is never the reason a process refuses to exit
        renewal.unref();
        return {
            key: heartbeatKey,
            validateAlive: async held => {
                if (await client.exists([heartbeatKey]) === 0) {
                    throw new InternalError(
                        `The heartbeat "${heartbeatKey}" lapsed, so ${held} may have been deleted as left behind by a process that died.`
                    );
                }
            },
            stop: async () => {
                clearInterval(renewal);
                const end: Batch = new (valKeyGlide().Batch)(true);
                end.del([heartbeatKey]);
                end.srem(this.resolveAsideRunsKey(), [runId]);
                await client.exec(end, true);
            }
        };
    }

    /**
     * Renews a heartbeat once, logging a warning when the renewal fails.
     * @param client - The client to write it with.
     * @param heartbeatKey - The key of the heartbeat.
     */
    private async renewAsideHeartbeat(client: GlideClient, heartbeatKey: string): Promise<void> {
        try {
            await client.pexpire(heartbeatKey, ASIDE_HEARTBEAT_TTL_IN_MS);
        }
        catch (error) {
            // the next renewal may land; one that never does is told by validateAlive
            const reason: string = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Could not renew the heartbeat of "${heartbeatKey}": ${reason}`);
        }
    }

    /**
     * Deletes what the snapshots and restores whose heartbeat lapsed held aside: those whose process
     * died before it let go of them.
     * @param client - The client to delete with.
     */
    private async sweepLeftAside(client: GlideClient): Promise<void> {
        const runIds: string[] = [...await client.smembers(this.resolveAsideRunsKey())].map(String);
        if (!runIds.length) {
            return;
        }
        const batch: Batch = new (valKeyGlide().Batch)(false);
        for (const runId of runIds) {
            batch.exists([this.resolveAsideHeartbeatKey(runId)]);
        }
        const alive: GlideReturnType[] = await client.exec(batch, true) ?? [];
        const dead: string[] = runIds.filter((_, i) => alive[i] === 0);
        if (!dead.length) {
            return;
        }
        const runsKey: string = ValKeyCopyOnWriteUtilities.getRunsKey(this.keyPrefix);
        const copiedOnWrite: boolean[] = await client.smismember(runsKey, dead);
        // no longer copied for before the copies are deleted, as a walk's stop does: a write copying while
        // they are deleted could copy behind it, and that copy would stay for good. Writes copy for no run
        // whose heartbeat is gone in the first place, which this keeps true should that change
        await client.srem(runsKey, dead);
        for (const [i, runId] of dead.entries()) {
            if (copiedOnWrite[i] === true) {
                await this.deleteCopyOnWriteKeys(client, runId);
            }
            else {
                // a snapshot or a restore, whose keys are a copy of every key the server holds: an id is
                // either kind, so both are looked for
                await this.deleteKeys(client, `${this.keyPrefix}:${BACKUP_SNAPSHOT_SEGMENT}:${runId}:*`);
                await this.deleteKeys(client, `${this.keyPrefix}:${RESTORE_STAGING_SEGMENT}:${runId}:*`);
            }
            this.logger.warn(
                `Deleted the keys a backup or restore of "${this.constructor.name}" held aside as "${runId}"`
                + ' when its process died.'
            );
        }
        // listed for sweeping until its keys are gone, so that a sweep failing part way is taken up by the next one
        await client.srem(this.resolveAsideRunsKey(), dead);
    }

    /**
     * The key listing every snapshot and restore holding keys aside.
     * @returns The key.
     */
    private resolveAsideRunsKey(): string {
        return `${this.keyPrefix}:${ASIDE_SEGMENT}:runs`;
    }

    /**
     * The key of the heartbeat of a snapshot or restore holding keys aside.
     * @param runId - Its id.
     * @returns The key.
     */
    private resolveAsideHeartbeatKey(runId: string): string {
        // through the utilities, since the guard script looks for the heartbeat of each run under the same name
        return `${ValKeyCopyOnWriteUtilities.getHeartbeatPrefix(this.keyPrefix)}${runId}`;
    }

    /**
     * Resolves how much memory the server has free: what it is limited to, its `maxmemory` or else
     * the memory of its machine, less what it uses.
     * @param client - The client to ask with.
     * @returns The bytes, or undefined when the server tells of no limit.
     */
    private async resolveFreeMemoryBytes(client: GlideClient): Promise<number | undefined> {
        const info: string = await client.info([valKeyGlide().InfoOptions.Memory]);
        const field: (name: string) => number = name => Number(new RegExp(`^${name}:(\\d+)\\s*$`, 'm').exec(info)?.[1] ?? 0);
        const limit: number = field('maxmemory') || field('total_system_memory');
        return limit ? Math.max(0, limit - field('used_memory')) : undefined;
    }

    /**
     * Formats a number of bytes for a message.
     * @param bytes - The bytes.
     * @returns The bytes in MiB, rounded up.
     */
    private formatMebibytes(bytes: number): string {
        return `${Math.ceil(bytes / (1024 * 1024))} MiB`;
    }

    /**
     * Reads the keys of the backup in the order of their names: the stored keys themselves, or the copies
     * a snapshot made of them.
     * @param client - The client to read with.
     * @param copyPrefix - The prefix of the copies of a snapshot, which are named without it and deleted
     * once read, or undefined to read the stored keys.
     * @param stagingFolder - Where the names are sorted, on this instance's disk.
     * @yields Each key still there by the time its batch is read, with what it holds and how long it
     * has left to live.
     */
    private async* walkBackupEntries(
        client: GlideClient,
        copyPrefix: string | undefined,
        stagingFolder: FsPath
    ): AsyncGenerator<ValKeyBackupEntry> {
        // the stored keys a backup leaves out, not read at all: among them every copy
        const unbackedPrefixes: string[] = this.resolveUnbackedKeyPrefixes();
        // a walk copies on write from before it scans on, so that it reads every key as it was then
        const run: CopyOnWriteRun | undefined = copyPrefix == undefined ? await this.startCopyOnWrite(client) : undefined;
        // a snapshot's copies, which nothing writes to until they are read, so that each one is found. A
        // walk's keys, and after them the keys copied on write since it began: a key deleted before the
        // scan reached it is among those, and so is a set whose members were all removed since
        const scanned: AsyncIterable<string[]> = run == undefined
            ? this.findCopyNamePages(client, copyPrefix ?? '')
            : this.concatenatePages(
                this.findBackedUpKeyPages(client, unbackedPrefixes),
                this.findCopyNamePages(client, run.view.valuePrefix),
                this.findCopyNamePages(client, run.view.removedPrefix)
            );
        // what a write past the data source copies nothing of can still put two rows read at different
        // moments in the backup holding one unique value. A snapshot's copies are of one moment. WATCHing
        // every key read would catch such a write, and was measured against: a WATCH call takes time linear
        // in the keys the connection watches already, so watching all is quadratic - about ten minutes for
        // the 200k keys of 100 MB, with the server answering nobody during each call, and ~285 B a key.
        // What else such a write tears is harmless: each key of its own is whole, and ids, indexes and
        // uniques are rebuilt on restore
        // Nothing reads only what changed either: keyspace notifications are pub/sub, lost while
        // disconnected, so no feed of changes is exact, and a full read is fast (100 MB in about 7 s)
        const uniqueCheck: ValKeyBackupUniqueCheck | undefined = run == undefined
            ? undefined
            : this.resolveUniqueCheck(client, stagingFolder);
        try {
            // sorted by name rather than read in the order of the scan, which follows the server's hash
            // table: copying every key for a snapshot, or a store that grew, resizes the table and reorders
            // keys, and a key moved is a chunk stored anew. On disk, so that what is held stays a run of
            // names however many keys there are. A key the scan finds twice is read once
            for await (const names of StagedSortUtilities.sortNames(scanned, stagingFolder, BACKUP_READ_KEYS)) {
                yield* run == undefined
                    ? this.readKeyPage(client, names.map(name => `${copyPrefix ?? ''}${name}`), copyPrefix ?? '')
                    : this.readKeyPageAsOf(client, names, run, uniqueCheck);
            }
            // as the snapshot checks its own: copies swept away as left behind would read as keys written since
            await run?.heartbeat.validateAlive('the values the walk copied on write');
            // before the backup ends, so that one a restore would refuse is never stored
            await uniqueCheck?.validate();
        }
        finally {
            uniqueCheck?.abort();
            await run?.stop();
        }
    }

    /**
     * Starts a walk copying on write: from now on, each write through the data source copies the key it
     * writes for it first, once.
     * @param client - The client to write with.
     * @returns The run.
     */
    private async startCopyOnWrite(client: GlideClient): Promise<CopyOnWriteRun> {
        await this.sweepLeftAside(client);
        const runId: string = UUIDUtilities.generate();
        // the heartbeat first, so that no other run takes this one for dead once writes copy for it
        const heartbeat: AsideHeartbeat = await this.startAsideHeartbeat(client, runId);
        const runsKey: string = ValKeyCopyOnWriteUtilities.getRunsKey(this.keyPrefix);
        try {
            await client.sadd(runsKey, [runId]);
        }
        catch (error) {
            await heartbeat.stop();
            throw error;
        }
        const runPrefix: string = ValKeyCopyOnWriteUtilities.getRunPrefix(this.keyPrefix, runId);
        return {
            view: ValKeyCopyOnWriteUtilities.resolveReadView(this.keyPrefix, runId, heartbeat.key),
            setPrefix: `${runPrefix}set:`,
            copiesKey: ValKeyCopyOnWriteUtilities.getCopiesKey(this.keyPrefix, runId),
            heartbeat,
            stop: async () => {
                // no longer copied for first, so that no write copies anything once the copies are deleted
                await client.srem(runsKey, [runId]);
                await this.deleteCopyOnWriteKeys(client, runId);
                await heartbeat.stop();
            }
        };
    }

    /**
     * Deletes the keys of a run copying on write that writes copy for no more: its copies, by the names
     * it listed as it made them, then the lists themselves. What it costs follows from what the run copied,
     * not from how many keys the server holds.
     * @param client - The client to delete with.
     * @param runId - The run.
     */
    private async deleteCopyOnWriteKeys(client: GlideClient, runId: string): Promise<void> {
        const copiesKey: string = ValKeyCopyOnWriteUtilities.getCopiesKey(this.keyPrefix, runId);
        let cursor: GlideString = '0';
        do {
            // as bytes, so that a key whose name is no text is deleted under the name it has
            const [next, copies]: [GlideString, GlideString[]] = await client.sscan(
                copiesKey,
                cursor,
                { count: SET_PAGE_MEMBERS, decoder: valKeyGlide().Decoder.Bytes }
            );
            cursor = next;
            if (copies.length) {
                await client.del(copies);
            }
        } while (cursor.toString() !== '0');
        // the list last, so that a deletion failing part way leaves what is left of the copies listed
        await client.del([ValKeyCopyOnWriteUtilities.getAbsentKey(this.keyPrefix, runId), copiesKey]);
    }

    /**
     * Opens what a transaction reading as of one moment reads through: a run copying on write, begun now.
     * @param client - The client to write with.
     * @returns The view, and how it is let go of.
     */
    private async openReadView(client: GlideClient): Promise<ValKeyReadViewHandle> {
        const run: CopyOnWriteRun = await this.startCopyOnWrite(client);
        return {
            view: run.view,
            stop: run.stop
        };
    }

    /**
     * Hands over the pages of each source in turn, the next one started once the one before ended.
     * @param sources - The sources.
     * @yields Their pages.
     */
    private async* concatenatePages(...sources: AsyncIterable<string[]>[]): AsyncGenerator<string[]> {
        for (const source of sources) {
            yield* source;
        }
    }

    /**
     * Resolves the check of the uniques of the entities a backup reads that declare any.
     * @param client - The client the backup reads with.
     * @param stagingFolder - Where the entries are sorted, on this instance's disk.
     * @returns The check, or undefined when no entity backed up declares a unique.
     */
    private resolveUniqueCheck(client: GlideClient, stagingFolder: FsPath): ValKeyBackupUniqueCheck | undefined {
        const entities: ValKeyCheckedEntity[] = this.entities
            .filter(entity => MetadataUtilities.getEntityMetadata(entity)?.backedUp !== false)
            .map(entity => ({ driver: new ValKeyRepositoryDriver(entity, client, this.keyPrefix, this), name: entity.name }))
            .filter(e => e.driver.holdsUniques());
        return entities.length ? new ValKeyBackupUniqueCheck(entities, stagingFolder) : undefined;
    }

    /**
     * The stored keys a backup takes, a page of the scan at a time.
     * @param client - The client to scan with.
     * @param unbackedPrefixes - What {@link resolveUnbackedKeyPrefixes} answered.
     * @yields The keys of each page that a backup takes.
     */
    private async* findBackedUpKeyPages(client: GlideClient, unbackedPrefixes: string[]): AsyncGenerator<string[]> {
        for await (const page of ValKeyScanUtilities.findKeyPages(client, `${this.keyPrefix}:*`)) {
            yield page.filter(key => this.isBackedUp(key, unbackedPrefixes));
        }
    }

    /**
     * The copies of a snapshot, a page of the scan at a time, each named as the key it copies.
     * @param client - The client to scan with.
     * @param copyPrefix - The prefix of the copies.
     * @yields The names of each page, without the prefix.
     */
    private async* findCopyNamePages(client: GlideClient, copyPrefix: string): AsyncGenerator<string[]> {
        // without the prefix every copy shares, which would take as much of a run, on the disk and held,
        // as the names themselves
        for await (const page of ValKeyScanUtilities.findKeyPages(client, `${copyPrefix}*`)) {
            yield page.map(key => key.slice(copyPrefix.length));
        }
    }

    /**
     * Reads a page of the copies of a snapshot: whole, or in pages of members for a set too large for that.
     * @param client - The client to read with.
     * @param keys - The copies.
     * @param copyPrefix - The prefix of the copies, which are named without it and deleted once read.
     * @yields Each key still there by the time it is read.
     */
    private async* readKeyPage(client: GlideClient, keys: string[], copyPrefix: string): AsyncGenerator<ValKeyBackupEntry> {
        const shapes: ValKeyKeyShape[] = await this.resolveKeyShapes(client, keys);
        yield* this.dumpBackupEntries(client, keys.filter((_, i) => shapes[i]?.paged !== true), copyPrefix);
        for (const [i, key] of keys.entries()) {
            const shape: ValKeyKeyShape | undefined = shapes[i];
            if (shape?.paged !== true) {
                continue;
            }
            // the copy of the snapshot, which nothing writes to: its pages are the set at that moment
            yield* this.readSetPages(client, key, key.slice(copyPrefix.length), shape.ttlMs);
            await client.del([key]);
        }
    }

    /**
     * Reads a page of keys of a walk copying on write, each as it was when the walk began, in one step:
     * whole, or in pages of members for a set too large for that.
     * @param client - The client to read with.
     * @param keys - The keys.
     * @param run - The walk.
     * @param uniqueCheck - What holds the rows read to the uniques of their entities, if anything does.
     * @yields Each key there when the walk began.
     */
    private async* readKeyPageAsOf(
        client: GlideClient,
        keys: string[],
        run: CopyOnWriteRun,
        uniqueCheck: ValKeyBackupUniqueCheck | undefined
    ): AsyncGenerator<ValKeyBackupEntry> {
        if (!keys.length) {
            return;
        }
        const checked: (ValKeyCheckedEntity | undefined)[] = keys.map(key => uniqueCheck?.findEntity(key));
        const reply: GlideReturnType | undefined = await this.invokeBackupScript(
            client,
            COPY_ON_WRITE_READ_SCRIPT,
            [
                run.view.valuePrefix,
                run.view.absentKey,
                `${SET_DUMPED_MEMBERS}`,
                run.view.addedPrefix,
                run.view.removedPrefix,
                run.view.brokenKey,
                ...keys.flatMap((key, i) => [key, checked[i] == undefined ? '0' : '1'])
            ],
            valKeyGlide().Decoder.Bytes
        );
        const answers: GlideReturnType[] = Array.isArray(reply) ? reply : [];
        this.validateSetHeldAsOf(answers[0]);
        for (const [i, key] of keys.entries()) {
            const answer: GlideReturnType | undefined = answers[i];
            const [state, read, ttl, fields] = Array.isArray(answer) ? answer : [];
            const ttlMs: number = typeof ttl === 'number' && ttl > 0 ? ttl : 0;
            if (state === 2) {
                yield* this.readLargeSetAsOf(client, key, toReplyText(read), ttlMs, run);
                continue;
            }
            if (state !== 1) {
                continue;
            }
            const entity: ValKeyCheckedEntity | undefined = checked[i];
            if (entity != undefined) {
                await uniqueCheck?.add(entity, key, entity.driver.resolveFieldList(fields));
            }
            yield this.toBackupEntry(key, read, ttl);
        }
    }

    /**
     * Validates that a read of a walk copying on write could hold every set as it was when the walk began.
     * @param first - The first answer of the read.
     * @throws When a write of a set whole needed more memory than the server had free for the copy.
     */
    private validateSetHeldAsOf(first: GlideReturnType | undefined): void {
        if (Array.isArray(first) && first[0] === -1) {
            throw new InternalError(
                `The backup of "${this.constructor.name}" could not hold the set "${toReplyText(first[1])}"`
                + ' as it was when the backup began: a write of it whole needed more memory than Valkey had free for the copy.'
                + ' Raise its maxmemory.'
            );
        }
    }

    /**
     * Reads a set as it was when a walk copying on write began, in pages: one too large to be read whole,
     * or one whose members a write changed since. From the copy a write made of it, or from a copy of it
     * alone made at one moment, which no write made one before, without the members added since and with
     * those removed since.
     * @param client - The client to read with.
     * @param key - The set.
     * @param source - What it is read from: the copy a write made, or the set itself.
     * @param ttlMs - How long it has left to live, 0 when it does not expire.
     * @param run - The walk.
     * @yields A page of members each, as an entry of the backup.
     */
    private async* readLargeSetAsOf(
        client: GlideClient,
        key: string,
        source: string,
        ttlMs: number,
        run: CopyOnWriteRun
    ): AsyncGenerator<ValKeySetMembersEntry> {
        const copiedOnWrite: string = `${run.view.valuePrefix}${key}`;
        // the copy a write made, which nothing writes to again
        if (source !== key) {
            yield* this.readSetPages(client, source, key, ttlMs);
            return;
        }
        // read in pages while it is written, a set would be no one value it ever held, so it is read from a
        // copy of it alone, made at one moment, unless a write copied it meanwhile
        const copy: string = `${run.setPrefix}${key}`;
        const copied: 'copied' | 'gone' | 'copied-on-write' = await this.copySetAside(client, key, copy, copiedOnWrite, run.copiesKey);
        if (copied === 'copied-on-write') {
            yield* this.readSetPages(client, copiedOnWrite, key, ttlMs);
            return;
        }
        try {
            // after the copy, so that a member a write changed between the two is noted by now. Bounded by
            // what was written since, not by the set
            const [added, removed]: [string[], string[]] = await Promise.all([
                this.readMembersBase64(client, `${run.view.addedPrefix}${key}`),
                this.readMembersBase64(client, `${run.view.removedPrefix}${key}`)
            ]);
            const addedSince: Set<string> = new Set(added);
            if (copied === 'copied') {
                for await (const page of this.readSetPages(client, copy, key, ttlMs)) {
                    const members: string[] = page.members.filter(m => !addedSince.has(m));
                    if (members.length) {
                        yield { ...page, members };
                    }
                }
            }
            // held when the walk began, gone since: a member the copy holds as well is added twice, which
            // leaves the set as it was
            for (let i: number = 0; i < removed.length; i += SET_PAGE_MEMBERS) {
                yield { key, ttlMs, kind: 'set-members', members: removed.slice(i, i + SET_PAGE_MEMBERS) };
            }
        }
        finally {
            if (copied === 'copied') {
                await client.del([copy]);
            }
        }
    }

    /**
     * Reads every member of a set, encoded as a backup entry holds them.
     * @param client - The client to read with.
     * @param key - The set.
     * @returns Its members as base64, none when it does not exist.
     */
    private async readMembersBase64(client: GlideClient, key: string): Promise<string[]> {
        const members: Set<GlideString> = await client.smembers(key, { decoder: valKeyGlide().Decoder.Bytes });
        return [...members].map(m => Buffer.from(m).toString('base64'));
    }

    /**
     * Reads whether each key is a set too large to be read whole, and how long it has left to live.
     * @param client - The client to read with.
     * @param keys - The keys.
     * @returns What each key is, in the order of the keys.
     */
    private async resolveKeyShapes(client: GlideClient, keys: string[]): Promise<ValKeyKeyShape[]> {
        if (!keys.length) {
            return [];
        }
        const batch: Batch = new (valKeyGlide().Batch)(false);
        for (const key of keys) {
            batch.type(key);
            batch.pttl(key);
            // answered with an error for a key that is no set, which is handed back rather than thrown
            batch.scard(key);
        }
        const replies: GlideReturnType[] = await client.exec(batch, false) ?? [];
        return keys.map((_, i) => {
            const ttlMs: GlideReturnType | undefined = replies[(i * 3) + 1];
            const members: GlideReturnType | undefined = replies[(i * 3) + 2];
            return {
                paged: replies[i * 3] === 'set' && typeof members === 'number' && members > SET_DUMPED_MEMBERS,
                ttlMs: typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : 0
            };
        });
    }

    /**
     * Reads keys whole, as `DUMP` makes them, in one request.
     * @param client - The client to read with.
     * @param keys - The keys.
     * @param copyPrefix - The prefix of the copies of a snapshot, which are named without it and deleted
     * once read, or undefined when the keys read are the stored ones.
     * @yields Each key still there by the time it is read.
     */
    private async* dumpBackupEntries(client: GlideClient, keys: string[], copyPrefix: string): AsyncGenerator<ValKeyDumpedEntry> {
        if (!keys.length) {
            return;
        }
        // one request per page rather than two per key
        const batch: Batch = new (valKeyGlide().Batch)(false);
        for (const key of keys) {
            batch.dump(key);
            batch.pttl(key);
        }
        // in the same request, so that the server holds the second copy of a key only until it is read
        batch.del(keys);
        const replies: GlideReturnType[] = await client.exec(batch, true, { decoder: valKeyGlide().Decoder.Bytes }) ?? [];
        for (const [i, key] of keys.entries()) {
            const payload: GlideReturnType | undefined = replies[i * 2];
            // expired since it was copied: a copy keeps the time its key had left
            if (payload == undefined) {
                continue;
            }
            yield this.toBackupEntry(key.slice(copyPrefix.length), payload, replies[(i * 2) + 1]);
        }
    }

    /**
     * Reads the members of a set a page at a time.
     * @param client - The client to read with.
     * @param source - The key read, which nothing writes to while it is.
     * @param key - The key the members are restored under.
     * @param ttlMs - How long the set has left to live, 0 when it does not expire.
     * @yields A page of members each, as an entry of the backup.
     */
    private async* readSetPages(client: GlideClient, source: string, key: string, ttlMs: number): AsyncGenerator<ValKeySetMembersEntry> {
        let cursor: GlideString = '0';
        do {
            const [next, members]: [GlideString, GlideString[]] = await client.sscan(
                source,
                cursor,
                { count: SET_PAGE_MEMBERS, decoder: valKeyGlide().Decoder.Bytes }
            );
            cursor = next;
            // a member a scan hands back twice is added twice, which leaves the set as it was
            if (members.length) {
                yield { key, ttlMs, kind: 'set-members', members: members.map(member => Buffer.from(member).toString('base64')) };
            }
        } while (cursor.toString() !== '0');
    }

    /**
     * Copies a set at one moment, for a walk to read it in pages, unless a write copied it for the walk.
     * @param client - The client to copy with.
     * @param key - The set.
     * @param copy - The key of the copy.
     * @param copiedOnWrite - The key of the copy a write makes for the walk.
     * @param copiesKey - The set of the copies the walk made, which lists this one.
     * @returns Whether it was copied, is gone, or was copied by a write, which is read instead.
     * @throws When the server has less memory free than the copy needs.
     */
    private async copySetAside(
        client: GlideClient,
        key: string,
        copy: string,
        copiedOnWrite: string,
        copiesKey: string
    ): Promise<'copied' | 'gone' | 'copied-on-write'> {
        const freeBytes: number | undefined = await this.resolveFreeMemoryBytes(client);
        const reply: GlideReturnType | undefined = await this.invokeBackupScript(
            client,
            SET_COPY_SCRIPT,
            [key, copy, `${freeBytes ?? -1}`, copiedOnWrite, copiesKey]
        );
        const answer: GlideReturnType[] = Array.isArray(reply) ? reply : [];
        if (answer[0] === -1) {
            throw new InternalError([
                `The backup of "${this.constructor.name}" could not read the set "${key}", which it reads from a copy of it.`,
                `Valkey needs to have ${this.formatMebibytes(Number(answer[1]))} free for the copy,`
                + ` and has ${this.formatMebibytes(freeBytes ?? 0)}.`,
                'Raise its maxmemory.'
            ]);
        }
        if (answer[0] === 2) {
            return 'copied-on-write';
        }
        return answer[0] === 1 ? 'copied' : 'gone';
    }

    /**
     * Runs a script of a backup or a restore, waiting for it as long as it takes.
     *
     * Sent as a batch of one, since a batch can be given a timeout and a script invoked on its own
     * cannot.
     * @param client - The client to run it with.
     * @param source - The script.
     * @param args - What it is given as ARGV.
     * @param decoder - What its answer is decoded into, text unless given.
     * @returns What it answered.
     */
    private async invokeBackupScript(
        client: GlideClient,
        source: string,
        args: string[],
        decoder?: Decoder
    ): Promise<GlideReturnType | undefined> {
        const batch: Batch = new (valKeyGlide().Batch)(false);
        batch.customCommand(['EVAL', source, '0', ...args]);
        const replies: GlideReturnType[] | null = await client.exec(batch, true, { timeout: BACKUP_SCRIPT_TIMEOUT_IN_MS, decoder });
        return replies?.[0];
    }

    /**
     * Deletes every key matching a pattern, a page of the scan at a time.
     * @param client - The client to delete with.
     * @param pattern - The keys to delete.
     */
    private async deleteKeys(client: GlideClient, pattern: string): Promise<void> {
        for await (const keys of ValKeyScanUtilities.findKeyPages(client, pattern)) {
            await client.del(keys);
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
    private toBackupEntry(key: string, payload: GlideReturnType | undefined, ttlMs: GlideReturnType | undefined): ValKeyDumpedEntry {
        if (!Buffer.isBuffer(payload) || typeof ttlMs !== 'number') {
            throw new InternalError(`Could not back up the key "${key}": valkey answered no dump of it.`);
        }
        return { key, ttlMs: ttlMs > 0 ? ttlMs : 0, payload: payload.toString('base64') };
    }

    /**
     * Restores the given backup data, written as {@link restoreMode} says.
     *
     * Staged, the whole backup is read into a staging area first and only swapped in once all of it has
     * arrived, so that a stream which is cut, a line which does not parse or a key which will not
     * restore leaves what is already stored exactly as it was. The swap happens at one moment:
     * everything that was there is removed and everything staged takes its place, so no reader sees
     * half of the old state and half of the new one.
     *
     * Direct, what is stored is deleted and the backup written in its place a batch at a time, so a
     * failure part way leaves part of the backup stored, which the backup service puts back from its
     * snapshot.
     *
     * Either way, keys which did not exist when the backup was created do not survive the restore, and
     * once it is written, what the backup holds is brought in line with this version of the app: every
     * migration it has not recorded runs, and the indexes and uniques are built as the entities
     * declare them. A backup taken by a newer version of the app is refused.
     * @param backupData - The backup data to restore.
     * @throws When the data source has not been initialized yet, or when the backup could not be
     * read - in which case nothing has been changed when staged. When the backup was taken by a newer
     * version of the app, when a migration fails, or when the restored rows break a declared unique or check.
     */
    async restoreBackup(backupData: Readable): Promise<void> {
        const client: GlideClient | undefined = this.client;
        if (!client) {
            throw new DataSourceInitializationError();
        }
        if (this.resolveRestoreMode() === 'direct') {
            await this.restoreDirectly(client, backupData);
        }
        else if (!await this.restoreStaged(client, backupData)) {
            // nothing was there and nothing was restored
            return;
        }

        // a row and what is kept about it are only as consistent as the backup was taken, and a walk
        // takes them at different moments. Under the schema lock, so that no instance starting up
        // reconciles or migrates them at the same time. Not around the writes: the lock is a key under
        // the prefix, which a restore deletes
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
     * Deletes what is stored and writes the keys of the backup in its place, a batch at a time, while the
     * server goes on answering. What the backup leaves out stays: the rows of the entities not backed
     * up, and what the backups and restores running hold aside.
     * @param client - The client to restore through.
     * @param backupData - The backup data to read.
     */
    private async restoreDirectly(client: GlideClient, backupData: Readable): Promise<void> {
        await this.deleteBackedUpKeys(client);
        await this.writeBackupEntries(client, backupData, '');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteBackedUpData(): Promise<void> {
        const client: GlideClient | undefined = this.client;
        if (!client) {
            throw new DataSourceInitializationError();
        }
        await this.deleteBackedUpKeys(client);
    }

    /**
     * Deletes the keys a backup takes, a page of the scan at a time. What it leaves out stays: the rows of the
     * entities not backed up, and what the backups and restores running hold aside.
     * @param client - The client to delete with.
     */
    private async deleteBackedUpKeys(client: GlideClient): Promise<void> {
        const unbackedPrefixes: string[] = this.resolveUnbackedKeyPrefixes();
        for await (const keys of ValKeyScanUtilities.findKeyPages(client, `${this.keyPrefix}:*`)) {
            const replaced: string[] = keys.filter(key => this.isBackedUp(key, unbackedPrefixes));
            if (replaced.length) {
                await client.del(replaced);
            }
        }
    }

    /**
     * What a staged restore that failed tells: of a server that ran out of memory staging the backup, what it
     * needs and what to do, and otherwise the error as it is.
     * @param client - The client to ask the server with.
     * @param error - What staging failed with.
     * @returns The error to throw.
     */
    private async resolveOutOfMemoryError(client: GlideClient, error: unknown): Promise<unknown> {
        if (!(error instanceof Error) || !error.message.includes('OOM')) {
            return error;
        }
        // what was staged is deleted by now, so what the server uses is what it stores
        let used: number | undefined;
        let limit: number | undefined;
        try {
            const info: string = await client.info([valKeyGlide().InfoOptions.Memory]);
            const field: (name: string) => number = name => Number(new RegExp(`^${name}:(\\d+)\\s*$`, 'm').exec(info)?.[1] ?? 0);
            used = field('used_memory');
            limit = field('maxmemory') || undefined;
        }
        catch {
            // the advice holds without the numbers
        }
        const held: string = used == undefined ? 'as much as it stores now' : Bytes.format(used);
        const atLimit: string = limit == undefined ? '' : `, at its maxmemory of ${Bytes.format(limit)}`;
        const raisedTo: string = used == undefined || limit == undefined ? '' : `, to ${Bytes.format(limit + used)}`;
        return new InternalError(
            [
                `The Valkey server of "${this.constructor.name}" ran out of memory while the restore staged the backup`
                + ` beside what it stores${atLimit}. Nothing was swapped in, and nothing changed.`,
                `A restore with restoreMode 'staged' holds what is stored and the backup at once: what is stored takes ${held}.`,
                'Any one of these lets it go on:',
                `- Raise maxmemory by ${held}${raisedTo}.`,
                `- Restore with restoreMode 'direct' on "${this.constructor.name}", which writes the backup in place`
                + ' and holds no copy beside it.',
                '  Downside: requests meanwhile see part of the backup, and a restore that fails part way'
                + ' is put back from the copy on this',
                '  instance\'s disk.',
                '- Restore with restore(backup, { deleteFirst: true }), which deletes what is stored before the backup is staged.'
                + ' Downside: what',
                '  is stored is gone until a restore succeeds. With putBack, the default,'
                + ' the restore keeps a copy on this instance\'s disk,',
                '  and puts it back when it fails.'
            ],
            { cause: error }
        );
    }

    /**
     * Writes the backup beside what is stored, and swaps it in at one moment.
     * @param client - The client to restore through.
     * @param backupData - The backup data to read.
     * @returns Whether anything was deleted or swapped in.
     */
    private async restoreStaged(client: GlideClient, backupData: Readable): Promise<boolean> {
        // one of its own per restore, so that what another one staged, or one stopped part way left
        // behind, is never swapped in with it
        const runId: string = UUIDUtilities.generate();
        const stagingPrefix: string = `${this.keyPrefix}:${RESTORE_STAGING_SEGMENT}:${runId}:`;
        await this.sweepLeftAside(client);
        const heartbeat: AsideHeartbeat = await this.startAsideHeartbeat(client, runId);
        let swapped: GlideReturnType | undefined;
        try {
            try {
                await this.stageBackup(client, backupData, stagingPrefix);
            }
            catch (error) {
                throw await this.resolveOutOfMemoryError(client, error);
            }
            // staged keys live under the prefix too, and with them what is held aside by other backups
            // and restores, so they are kept out of what is swept away, and so are the keys of the
            // entities whose rows the restore keeps. The heartbeat is looked at in the same script: one
            // that lapsed may have had the staged keys swept, and swapping in what is left of them
            // would replace the store with part of the backup
            swapped = await this.invokeBackupScript(
                client,
                RESTORE_SWAP_SCRIPT,
                [`${this.keyPrefix}:*`, stagingPrefix, heartbeat.key, ...this.resolveUnbackedKeyPrefixes()]
            );
            if (swapped === -1) {
                await this.deleteKeys(client, `${stagingPrefix}*`);
                throw new InternalError(
                    `The heartbeat "${heartbeat.key}" of the restore lapsed, so the keys it staged may have been deleted as left `
                    + 'behind by a process that died. Nothing was swapped in.'
                );
            }
        }
        finally {
            await heartbeat.stop();
        }
        return swapped !== 0;
    }

    /**
     * Restores every entry of the backup under the given staging prefix, a batch at a time.
     *
     * Nothing that is already stored is touched here. A failure part way through leaves only staged
     * keys behind, which are cleaned up before the error is passed on.
     * @param client - The client to restore through.
     * @param backupData - The backup data to read.
     * @param stagingPrefix - The prefix the keys are restored under, including its trailing separator.
     * @throws Whatever reading or restoring the backup threw.
     */
    private async stageBackup(client: GlideClient, backupData: Readable, stagingPrefix: string): Promise<void> {
        try {
            await this.writeBackupEntries(client, backupData, stagingPrefix);
        }
        catch (error) {
            await this.deleteKeys(client, `${stagingPrefix}*`);
            throw error;
        }
    }

    /**
     * Writes every entry of the backup under the given prefix, a batch at a time.
     * @param client - The client to restore through.
     * @param backupData - The backup data to read.
     * @param prefix - The prefix the keys are written under, including its trailing separator, or `''`
     * for the names they were backed up under.
     * @throws Whatever reading or writing the backup threw.
     */
    private async writeBackupEntries(client: GlideClient, backupData: Readable, prefix: string): Promise<void> {
        let pending: string[] = [];
        for await (const line of this.readBackupLines(backupData)) {
            pending.push(line);
            if (pending.length >= RESTORE_BATCH_SIZE) {
                await this.restoreEntries(client, pending, prefix);
                pending = [];
            }
        }
        await this.restoreEntries(client, pending, prefix);
    }

    /**
     * Reads the lines of a backup.
     * @param backupData - The backup data.
     * @yields Each line, empty ones among them.
     */
    private async* readBackupLines(backupData: Readable): AsyncGenerator<string> {
        let rest: string = '';
        // a decoder rather than a string per chunk: the data arrives as bytes, and a character
        // spanning two chunks decoded one chunk at a time comes out as two replacement characters
        const decoder: StringDecoder = new StringDecoder('utf8');
        for await (const chunk of backupData) {
            rest += Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk);
            const lines: string[] = rest.split('\n');
            rest = lines.pop() ?? '';
            yield* lines;
        }
        yield rest + decoder.end();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveRestoresWhole(backupData: Readable): Promise<boolean> {
        // written in place of what is stored, a restore failing part way leaves part of the backup
        if (this.resolveRestoreMode() === 'direct') {
            return false;
        }
        const client: GlideClient | undefined = this.client;
        if (!client) {
            throw new DataSourceInitializationError();
        }
        // staged, nothing changes until the swap, and after it nothing but the migrations may fail
        try {
            return isMigratedAsOf(await this.findBackedUpMigrations(client, backupData), this.migrations);
        }
        catch (error) {
            // kept rather than skipped: the copy to put back costs disk, a restore without one when a
            // migration fails costs the data the application held
            this.logger.warn(
                `Could not read which migrations the backup of "${this.constructor.name}" records,`
                + ' so the restore keeps a copy to put back: '
                + (error instanceof Error ? error.message : String(error))
            );
            return false;
        }
    }

    /**
     * Reads the migrations a backup records, from the rows of the migration table it holds. Each is
     * restored under a key of its own, read and deleted again in one step, which nothing else sees.
     *
     * Every line is looked at: a backup taken before keys were written in the order of their names holds
     * the rows anywhere.
     * @param client - The client to read through.
     * @param backupData - The backup data.
     * @returns The migrations, none when the backup holds no migration table.
     */
    private async findBackedUpMigrations(client: GlideClient, backupData: Readable): Promise<RecordedMigration[]> {
        const driver: ValKeyRepositoryDriver<MigrationEntity> = new ValKeyRepositoryDriver(MigrationEntity, client, this.keyPrefix, this);
        const rowKeyPrefix: string = `${this.keyPrefix}:${MetadataUtilities.getEntityMetadata(MigrationEntity)?.tableName ?? ''}:`;
        // as a line names the key, without the closing quote: only those lines are parsed
        const named: string = `"key":${JsonUtilities.stringify(rowKeyPrefix).slice(0, -1)}`;
        const res: RecordedMigration[] = [];
        for await (const line of this.readBackupLines(backupData)) {
            if (!line.includes(named)) {
                continue;
            }
            const entry: ValKeyBackupEntry = JsonUtilities.parse(line);
            if ('kind' in entry || driver.findRowId(entry.key) == undefined) {
                continue;
            }
            const temporary: string = `${this.keyPrefix}:${RESTORE_STAGING_SEGMENT}:migration-${UUIDUtilities.generate()}`;
            const batch: Batch = new (valKeyGlide().Batch)(true);
            batch.restore(temporary, 0, Buffer.from(entry.payload, 'base64'), { replace: true });
            batch.hgetall(temporary);
            batch.del([temporary]);
            // handed back rather than thrown: the lists the table keeps are named as rows are, and are no hashes
            const [restored, read]: GlideReturnType[] = await client.exec(batch, false) ?? [];
            // a row that does not restore is a migration this cannot tell about, which may be one ahead
            if (restored instanceof Error) {
                throw restored;
            }
            if (read instanceof Error) {
                continue;
            }
            const fields: Record<string, string> | undefined = driver.resolveFields(read);
            if (fields?.['name'] == undefined || fields['version'] == undefined) {
                continue;
            }
            res.push({
                name: JsonUtilities.parse<string>(fields['name']),
                version: JsonUtilities.parse<MigrationEntity['version']>(fields['version']),
                ranAt: new Date(JsonUtilities.parse<string>(fields['ranAt'] ?? 'null') ?? 0)
            });
        }
        return res;
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

    /**
     * Restores the given lines of a backup under the given prefix, in one request.
     * @param client - The client to restore through.
     * @param lines - The lines, each one entry of the backup or empty.
     * @param stagingPrefix - The prefix the keys are restored under, including its trailing separator, or
     * `''` for the names they were backed up under.
     */
    private async restoreEntries(client: GlideClient, lines: string[], stagingPrefix: string): Promise<void> {
        const batch: Batch = new (valKeyGlide().Batch)(false);
        const unbackedPrefixes: string[] = this.resolveUnbackedKeyPrefixes();
        let restored: number = 0;
        for (const line of lines) {
            if (!line.trim()) {
                continue;
            }
            const entry: ValKeyBackupEntry = JsonUtilities.parse(line);
            // a backup taken before the entity was left out still holds its keys
            if (!this.isBackedUp(entry.key, unbackedPrefixes)) {
                continue;
            }
            const staged: string = `${stagingPrefix}${entry.key}`;
            if ('kind' in entry) {
                // a page of a large set: added to what the pages before it staged, so that the set is whole
                // before the swap, which is the only moment it is seen
                batch.sadd(staged, entry.members.map(member => Buffer.from(member, 'base64')));
                if (entry.ttlMs > 0) {
                    batch.pexpire(staged, entry.ttlMs);
                }
            }
            else {
                batch.restore(staged, entry.ttlMs, Buffer.from(entry.payload, 'base64'), { replace: true });
            }
            restored++;
        }
        if (restored) {
            await client.exec(batch, true);
        }
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

/**
 * Converts what a script of a backup answered with as the name of a key to a string.
 * @param value - The answer.
 * @returns The answer as a string.
 */
function toReplyText(value: GlideReturnType | undefined): string {
    // a script answers a name of a key as a bulk string, which is text or a Buffer; anything else is
    // stringified as it comes, to name it in an error message
    // eslint-disable-next-line typescript/no-base-to-string
    return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}