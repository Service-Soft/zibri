import type { GlideClient, GlideReturnType, Script } from '@valkey/valkey-glide';

import { TransactionLocksLostError } from './transaction-locks-lost.error';
import { TransactionSerializationError } from './transaction-serialization.error';
import { type ValKeyBufferedWrite, type ValKeyGrantRelease } from './val-key-transaction.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { JsonUtilities } from '../../utilities/json.utilities';
import { VAL_KEY_COPY_ON_WRITE_NAMES, ValKeyCopyOnWriteUtilities, type ValKeyReadView } from '../data-sources/val-key/val-key-copy-on-write.utilities';
import { valKeyGlide } from '../data-sources/val-key/val-key-glide.function';

/**
 * What a guarded write checks before it writes: what each guarded key and each guarded hash held
 * when it was read.
 */
export type ValKeyWriteGuards = {
    /**
     * The value each guarded key was read with, by key. An empty string for a key that did not exist.
     */
    values: Map<string, string>,
    /**
     * The fields each guarded hash was read with, by key. A hash holding anything else by now has
     * changed, one that is gone included.
     */
    hashes: Map<string, Record<string, string>>
};

/**
 * One write as the script reads it: what it does, the key, and the fields, field values or members.
 */
type ScriptWrite = [ValKeyBufferedWrite['type'], string, string[]];

/**
 * The script, once it has been built.
 *
 * Built on first use rather than at module scope, for the reason the lock scripts are: constructing
 * one needs the optional valkey client, and the barrel reaches this module in an application that
 * has none.
 */
let guardedWritesScript: Script | undefined;

/**
 * Applies the writes, but only while every grant to hand back is still held and every guarded key still
 * holds the value it was read with.
 *
 * Either all of them or none, as one command: the check and the writes cannot be told apart by any
 * other writer. Members and fields go in a thousand at a time, below what a single call takes.
 * @returns The script, which answers 1 when it wrote, 0 when a guarded key had changed, `[2, lock key,
 * holder]` when a grant was no longer held, the holder an empty string for a lock that is gone, 3 when a
 * key written was written by another writer since the moment the writer read as of, and 4 when what the
 * writer read through as of that moment lapsed. Nothing is written on any answer but 1.
 */
function resolveGuardedWritesScript(): Script {
    guardedWritesScript ??= new (valKeyGlide().Script)(
        'local payload = cjson.decode(ARGV[1]) '
        // a grant that lapsed may have been taken since, and the rows it guarded written by whoever took it.
        // Named with whoever holds it now, which tells a process that stalled past a hold from one taken over
        + 'for _, key in ipairs(payload[5]) do '
        + 'local holder = redis.call("get", key) '
        + 'if holder ~= payload[4] then return { 2, key, holder or "" } end '
        + 'end '
        // a transaction reading as of one moment overwrites nothing another one wrote since that moment, which
        // is what made a copy of it for the moment, or noted it as absent then. Members added and removed
        // commute, as the ids of a table every save adds to, and take no grant for it either
        + 'if payload[10] ~= "" then '
        // a view whose heartbeat lapsed may have had its copies deleted as left behind, and writes copy for
        // it no more, so that a write since that moment would pass the check below unseen
        + 'if redis.call("exists", payload[13]) == 0 then return 4 end '
        // eslint-disable-next-line sonar/no-duplicate-string
        + 'for _, write in ipairs(payload[3]) do '
        + 'if write[1] ~= "setAdd" and write[1] ~= "setRemove" '
        + 'and (redis.call("exists", payload[10] .. write[2]) == 1 or redis.call("sismember", payload[11], write[2]) == 1 '
        // members another one wrote to a set since, which writing it whole would overwrite
        + 'or redis.call("exists", payload[18] .. write[2]) == 1 or redis.call("exists", payload[19] .. write[2]) == 1) then return 3 end '
        + 'end '
        + 'end '
        + 'for _, guard in ipairs(payload[1]) do '
        + 'if (redis.call("get", guard[1]) or "") ~= guard[2] then return 0 end '
        + 'end '
        // a hash field by field: as many as it was read with, each holding what it held
        + 'for _, guard in ipairs(payload[2]) do '
        + 'local stored = redis.call("hgetall", guard[1]) '
        + 'if #stored ~= #guard[2] then return 0 end '
        + 'local fields = {} '
        + 'for i = 1, #stored, 2 do fields[stored[i]] = stored[i + 1] end '
        + 'for i = 1, #guard[2], 2 do if fields[guard[2][i]] ~= guard[2][i + 1] then return 0 end end '
        + 'end '
        // for every backup copying on write, each key as it was before the first write of it since the
        // backup began, or noted as absent then: what that backup reads of it. None for a run whose heartbeat
        // is gone, whose process died: listed until the next run sweeps it, it would have every write copy
        // for it meanwhile. One alive finds out at its next read or its end, both of which look at the heartbeat.
        // Its key is undeclared, as the copies are, which the single server a data source connects to allows
        + 'local function inChunks(command, key, members) '
        + 'for i = 1, #members, 1000 do redis.call(command, key, unpack(members, i, math.min(i + 999, #members))) end '
        + 'end '
        // whether a copy of the key fits into the memory the server has free: past it, under an eviction
        // policy, the server would evict the application's own keys to make room for the copy
        + 'local function fits(key) '
        + 'local info = redis.call("info", "memory") '
        + 'local limit = tonumber(string.match(info, "maxmemory:(%d+)")) or 0 '
        + 'if limit == 0 then limit = tonumber(string.match(info, "total_system_memory:(%d+)")) or 0 end '
        + 'if limit == 0 then return true end '
        + 'local used = tonumber(string.match(info, "used_memory:(%d+)")) or 0 '
        + 'return (redis.call("memory", "usage", key, "samples", "0") or 0) <= limit - used '
        + 'end '
        + 'for _, run in ipairs(redis.call("smembers", payload[6])) do '
        + 'if redis.call("exists", payload[12] .. run) == 1 then '
        + 'local base = payload[7] .. run .. ":" '
        + 'local absent = base .. payload[9] '
        // what the run makes is listed as it is made, so that the run deletes it by its name when it ends
        + 'local copies = base .. payload[14] '
        + 'for _, write in ipairs(payload[3]) do '
        + 'local key = write[2] '
        + 'local copy = base .. payload[8] .. key '
        + 'if redis.call("exists", copy) == 0 and redis.call("sismember", absent, key) == 0 then '
        + 'local added = base .. payload[15] .. key '
        + 'local removed = base .. payload[16] .. key '
        + 'local changed = redis.call("exists", added) == 1 or redis.call("exists", removed) == 1 '
        + 'local stored = redis.call("exists", key) == 1 '
        // members of a set, which commute, as the ids of a table every save adds to: rather than a copy of the
        // whole set, each member whose presence changes for the first time since the run began, as it was
        // then. Absent then, it is added since; present then, removed since
        + 'if (write[1] == "setAdd" or write[1] == "setRemove") and (changed or stored) then '
        + 'for _, member in ipairs(write[3]) do '
        + 'if redis.call("sismember", added, member) == 0 and redis.call("sismember", removed, member) == 0 then '
        + 'local present = redis.call("sismember", key, member) == 1 '
        + 'if write[1] == "setAdd" and not present then redis.call("sadd", added, member) redis.call("sadd", copies, added) '
        + 'elseif write[1] == "setRemove" and present then redis.call("sadd", removed, member) redis.call("sadd", copies, removed) end '
        + 'end '
        + 'end '
        + 'elseif stored then '
        // a set written whole, which only a copy as large as it keeps. One that does not fit is not copied:
        // the write goes on, and the run fails at its next read instead of the application's write
        + 'if redis.call("type", key)["ok"] == "set" and not fits(key) then '
        + 'redis.call("set", base .. payload[17], key) redis.call("sadd", copies, base .. payload[17]) '
        + 'else '
        + 'redis.call("copy", key, copy) redis.call("sadd", copies, copy) '
        // what it held when the run began, its members written since taken back
        // eslint-disable-next-line stylistic/max-len
        + 'if changed then inChunks("srem", copy, redis.call("smembers", added)) inChunks("sadd", copy, redis.call("smembers", removed)) end '
        + 'end '
        // a set whose members all went since, which held then those removed since
        + 'elseif changed and redis.call("exists", removed) == 1 then '
        + 'redis.call("sunionstore", copy, removed) redis.call("sadd", copies, copy) '
        + 'else redis.call("sadd", absent, key) end '
        + 'end '
        + 'end '
        + 'end '
        + 'end '
        + 'local commands = { hashSet = "hset", hashDelete = "hdel", setAdd = "sadd", setRemove = "srem" } '
        + 'for _, write in ipairs(payload[3]) do '
        + 'if write[1] == "delete" then redis.call("del", write[2]) '
        + 'else for i = 1, #write[3], 1000 do '
        + 'redis.call(commands[write[1]], write[2], unpack(write[3], i, math.min(i + 999, #write[3]))) '
        + 'end end '
        + 'end '
        // the grants after the writes they protected, and only those still holding the token
        + 'for _, key in ipairs(payload[5]) do '
        + 'if redis.call("get", key) == payload[4] then redis.call("del", key) end '
        + 'end return 1'
    );
    return guardedWritesScript;
}

/**
 * Applies writes as one atomic step, but only while the guarded keys and hashes hold what they were
 * read with.
 *
 * What a write needs when some of it was worked out from a value another instance may change at any
 * moment: checked here, the value and the writes derived from it are decided together, where checking
 * it first and writing afterwards would leave a window in which the value changes unseen.
 * Each key written is copied first for every backup copying on write that has not copied it yet, in the
 * same step, so that such a backup reads it as it was when the backup began. Of a set, only the members
 * written are noted, each as it was then, and a set written whole is copied only when the copy fits into
 * the memory the server has free: one that does not ends the backup at its next read, not the write.
 * @param client - The client to write through.
 * @param keyPrefix - The prefix of the data source the keys are of, under which the backups copying on
 * write are listed.
 * @param guards - What each guarded key and hash was read with.
 * @param writes - The writes, in the order they are applied.
 * @param release - The grants to hand back once the writes are applied, in the same step, each of which
 * has to be held still. Nothing is handed back when a guard refuses the writes.
 * @param readView - What the transaction writing read through, when it read as of one moment: no key it
 * writes may have been written since.
 * @returns True when the writes were applied, false when a guarded key or hash had changed and
 * nothing was.
 * @throws TransactionLocksLostError when a grant to hand back was no longer held, and nothing was applied.
 * @throws TransactionSerializationError when a key written was written by another one since the moment the
 * writer read as of, or what the writer read through lapsed, so that what was written since cannot be told,
 * and nothing was applied.
 * @throws When the script answers with something other than whether it wrote.
 */
export async function applyGuardedValKeyWrites(
    client: GlideClient,
    keyPrefix: string,
    guards: ValKeyWriteGuards,
    writes: ValKeyBufferedWrite[],
    release: ValKeyGrantRelease = { token: '', lockKeys: [], lastRenewedAt: undefined, holdInMs: 0 },
    readView?: ValKeyReadView
): Promise<boolean> {
    // building and writing the payload of a large commit is work of its own, which runs before the script
    // checks the grants: what an error about a lapsed one says how long it took
    const startedAt: number = Date.now();
    const payload: [
        [string, string][],
        [string, string[]][],
        ScriptWrite[],
        string,
        string[],
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
    ] = [
        [...guards.values.entries()],
        [...guards.hashes.entries()].map(([key, fields]) => [key, Object.entries(fields).flat()]),
        writes.map(w => toScriptWrite(w)),
        release.token,
        release.lockKeys,
        ValKeyCopyOnWriteUtilities.getRunsKey(keyPrefix),
        ValKeyCopyOnWriteUtilities.getRunsPrefix(keyPrefix),
        VAL_KEY_COPY_ON_WRITE_NAMES.value,
        VAL_KEY_COPY_ON_WRITE_NAMES.absent,
        readView?.valuePrefix ?? '',
        readView?.absentKey ?? '',
        ValKeyCopyOnWriteUtilities.getHeartbeatPrefix(keyPrefix),
        readView?.heartbeatKey ?? '',
        VAL_KEY_COPY_ON_WRITE_NAMES.copies,
        VAL_KEY_COPY_ON_WRITE_NAMES.added,
        VAL_KEY_COPY_ON_WRITE_NAMES.removed,
        VAL_KEY_COPY_ON_WRITE_NAMES.broken,
        readView?.addedPrefix ?? '',
        readView?.removedPrefix ?? ''
    ];
    const keys: string[] = [
        ...new Set([
            ...guards.values.keys(),
            ...guards.hashes.keys(),
            ...writes.map(w => w.key),
            ...release.lockKeys
        ])
    ];
    const args: string = JsonUtilities.stringify(payload);
    const res: GlideReturnType = await client.invokeScript(resolveGuardedWritesScript(), { keys, args: [args] });
    if (Array.isArray(res) && res[0] === 2) {
        throw new TransactionLocksLostError({
            cause: new InternalError(describeLostLock(res.map(part => String(part)), release, startedAt, args.length))
        });
    }
    if (res === 3) {
        throw new TransactionSerializationError();
    }
    if (res === 4) {
        // what it read may have been written since, as for any conflict, and a fresh attempt reads through a
        // view of its own: run again like one, rather than failing work a retry completes. The cause names
        // the stall, which only a process stalled for the heartbeat's life produces
        throw new TransactionSerializationError({
            cause: new InternalError(
                `The heartbeat "${readView?.heartbeatKey ?? ''}" of a transaction reading as of one moment lapsed, so what it reads`
                + ' through may have been deleted as left behind by a process that died.'
            )
        });
    }
    if (res !== 0 && res !== 1) {
        throw new InternalError('Applying writes behind a guard was answered with something other than whether it wrote.');
    }
    return res === 1;
}

/**
 * What tells why a grant was found lapsed: whether it is gone or another holds it, how long before the commit
 * the grants were last renewed, and how long the commit took before the script looked.
 * @param answer - The answer of the script: 2, the lock key, and who holds it now, empty when nobody does.
 * @param release - The grants the commit handed back.
 * @param startedAt - When the commit began building its payload.
 * @param payloadLength - How many characters the payload was.
 * @returns The description.
 */
function describeLostLock(answer: string[], release: ValKeyGrantRelease, startedAt: number, payloadLength: number): string {
    const [, lockKey = '', holder = ''] = answer;
    const renewed: string = release.lastRenewedAt == undefined
        ? 'They were never taken'
        : `They were last renewed or taken ${startedAt - release.lastRenewedAt} ms before the commit began`;
    return `The lock "${lockKey}" ${holder === '' ? 'was gone' : 'was held by another transaction'} at the commit, one of `
        + `the ${release.lockKeys.length} locks of the transaction, which live ${release.holdInMs} ms. ${renewed}, `
        + `which took ${Date.now() - startedAt} ms to send ${payloadLength} characters of writes and be answered.`;
}

/**
 * Writes one write the way the script reads it.
 * @param write - The write.
 * @returns What it does, its key, and what it writes.
 */
function toScriptWrite(write: ValKeyBufferedWrite): ScriptWrite {
    switch (write.type) {
        case 'hashSet': {
            return [write.type, write.key, Object.entries(write.values).flat()];
        }
        case 'hashDelete': {
            return [write.type, write.key, write.fields];
        }
        case 'delete': {
            return [write.type, write.key, []];
        }
        case 'setAdd':
        case 'setRemove': {
            return [write.type, write.key, write.members];
        }
    }
}