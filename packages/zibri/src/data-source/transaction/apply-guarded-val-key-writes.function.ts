import type { GlideClient, GlideReturnType, Script } from '@valkey/valkey-glide';

import { type ValKeyBufferedWrite } from './val-key-transaction.model.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { valKeyGlide } from '../data-sources/val-key/val-key-glide.function.ts';

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
 * Applies the writes, but only while every guarded key still holds the value it was read with.
 *
 * Either all of them or none, as one command: the check and the writes cannot be told apart by any
 * other writer. Members and fields go in a thousand at a time, below what a single call takes.
 * @returns The script, which answers 1 when it wrote and 0 when a guarded key had changed.
 */
function resolveGuardedWritesScript(): Script {
    guardedWritesScript ??= new (valKeyGlide().Script)(
        'local payload = cjson.decode(ARGV[1]) '
        + 'for _, guard in ipairs(payload[1]) do '
        + 'if (redis.call("get", guard[1]) or "") ~= guard[2] then return 0 end '
        + 'end '
        // cspell:disable-next-line
        + 'local commands = { hashSet = "hset", hashDelete = "hdel", setAdd = "sadd", setRemove = "srem" } '
        + 'for _, write in ipairs(payload[2]) do '
        + 'if write[1] == "delete" then redis.call("del", write[2]) '
        + 'else for i = 1, #write[3], 1000 do '
        + 'redis.call(commands[write[1]], write[2], unpack(write[3], i, math.min(i + 999, #write[3]))) '
        + 'end end '
        + 'end return 1'
    );
    return guardedWritesScript;
}

/**
 * Applies writes as one atomic step, but only while the guarded keys hold what they were read with.
 *
 * What a write needs when some of it was worked out from a value another instance may change at any
 * moment: checked here, the value and the writes derived from it are decided together, where checking
 * it first and writing afterwards would leave a window in which the value changes unseen.
 * @param client - The client to write through.
 * @param guards - The values each guarded key was read with, by key. An empty string for a key that
 * did not exist.
 * @param writes - The writes, in the order they are applied.
 * @returns True when the writes were applied, false when a guarded key had changed and nothing was.
 * @throws When the script answers with something other than whether it wrote.
 */
export async function applyGuardedValKeyWrites(
    client: GlideClient,
    guards: Map<string, string>,
    writes: ValKeyBufferedWrite[]
): Promise<boolean> {
    const payload: [[string, string][], ScriptWrite[]] = [[...guards.entries()], writes.map(w => toScriptWrite(w))];
    const keys: string[] = [...new Set([...guards.keys(), ...writes.map(w => w.key)])];
    const res: GlideReturnType = await client.invokeScript(resolveGuardedWritesScript(), {
        keys,
        args: [JsonUtilities.stringify(payload)]
    });
    if (res !== 0 && res !== 1) {
        throw new InternalError('Applying writes behind a guard was answered with something other than whether it wrote.');
    }
    return res === 1;
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