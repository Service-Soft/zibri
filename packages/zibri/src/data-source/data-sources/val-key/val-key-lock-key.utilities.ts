/**
 * Namespace for lock keys, so a lock can never collide with a stored entity.
 */
const LOCK_KEY_PREFIX: string = 'zibri.lock:';

/**
 * Names the keys the locks of a valkey data source live under.
 */
export class ValKeyLockKeyUtilities {

    /**
     * The key the lock on a key lives under. It holds the token of whoever holds the lock, and is
     * missing while nobody does.
     * @param key - The key that is locked.
     * @returns The key of its lock.
     */
    static getLockKey(key: string): string {
        return `${LOCK_KEY_PREFIX}${key}`;
    }

    /**
     * The key a lock is on.
     * @param lockKey - The key of the lock.
     * @returns The key that is locked.
     */
    static getLockedKey(lockKey: string): string {
        return lockKey.slice(LOCK_KEY_PREFIX.length);
    }
}