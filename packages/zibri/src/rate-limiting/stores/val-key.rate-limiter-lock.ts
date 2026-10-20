import type { GlideClient, GlideString, Script } from '@valkey/valkey-glide';

import { RateLimiterLockInterface } from './rate-limiter-lock.interface.ts';
import { ValKeyDataSource } from '../../data-source/data-sources/val-key/val-key-data-source.model.ts';
import { valKeyGlide } from '../../data-source/data-sources/val-key/val-key-glide.function.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';

/**
 * How long a lock is held at most, so that a crashed process cannot block a key forever.
 */
const LOCK_TTL_MS: number = 5000;

/**
 * How long to wait before trying to take a lock again.
 */
const LOCK_RETRY_DELAY_MS: number = 5;

/**
 * How often taking the lock is retried before giving up.
 */
const MAX_LOCK_ATTEMPTS: number = 400;

/**
 * The script, once it has been built.
 */
let releaseLockScript: Script | undefined;

/**
 * Releases a lock, but only when it is still the one that was taken.
 *
 * Without the comparison a lock that already expired could be released by the process that timed out
 * instead of by the one that holds it now.
 *
 * Built on first use rather than at module scope: constructing one needs the optional valkey client,
 * so doing it while this file loads would make every application need that package. Kept afterwards
 * because a `Script` is hashed once and invoked by that hash from then on.
 * @returns The script.
 */
function getReleaseLockScript(): Script {
    releaseLockScript ??= new (valKeyGlide().Script)(
        'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end'
    );
    return releaseLockScript;
}

/**
 * A rate limiter lock that lives on a valkey server, so it serializes updates across every instance
 * of an app instead of only within one process.
 *
 * ## Why a lock and not WATCH
 * The obvious way to make a read modify write cycle atomic on valkey is optimistic locking with
 * WATCH / MULTI / EXEC. That does not work here: WATCH is state of the connection, and the client
 * multiplexes every command over a single connection. Concurrent updates would all watch the same
 * key on the same connection, all read the same value, and the first EXEC would clear the watch for
 * all of them, so none of the others would be aborted and updates would silently be lost.
 */
export class ValKeyRateLimiterLock implements RateLimiterLockInterface {

    constructor(private readonly ds: ValKeyDataSource) {}

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async withLock<T>(key: string, run: () => Promise<T>): Promise<T> {
        const client: GlideClient = this.ds.connection;
        const lockKey: string = `${this.ds.keyPrefix}:rate-limit-lock:${key}`;
        const token: string = UUIDUtilities.generate();

        for (let attempt: number = 0; attempt < MAX_LOCK_ATTEMPTS; attempt++) {
            const acquired: GlideString | null = await client.set(lockKey, token, {
                conditionalSet: 'onlyIfDoesNotExist',
                expiry: { type: valKeyGlide().TimeUnit.Milliseconds, count: LOCK_TTL_MS }
            });

            if (acquired != undefined) {
                try {
                    return await run();
                }
                finally {
                    await client.invokeScript(getReleaseLockScript(), { keys: [lockKey], args: [token] });
                }
            }
            await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
        }

        throw new InternalError(
            `Could not update the rate limit "${key}", the lock was held by other clients for ${MAX_LOCK_ATTEMPTS} attempts.`
        );
    }
}