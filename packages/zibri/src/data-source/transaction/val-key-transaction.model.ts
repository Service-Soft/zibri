import type { Batch, GlideClient } from '@valkey/valkey-glide';

import { TransactionAlreadyFinishedError } from './transaction-already-finished.error';
import { Transaction } from './transaction.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { KeptGrant } from '../../leases/held-lease.model';
import { LoggerInterface } from '../../logging/logger.interface';
import { valKeyGlide } from '../data-sources/val-key/val-key-glide.function';

/**
 * A write that has been buffered inside a valkey transaction.
 */
export type ValKeyBufferedWrite = {
    /**
     * Writes the given fields into a hash.
     */
    type: 'hashSet',
    /**
     * The key of the hash.
     */
    key: string,
    /**
     * The fields to write.
     */
    values: Record<string, string>
}
| {
    /**
     * Removes fields from a hash, leaving the rest of it alone.
     */
    type: 'hashDelete',
    /**
     * The key of the hash.
     */
    key: string,
    /**
     * The fields to remove.
     */
    fields: string[]
}
| {
    /**
     * Deletes a key entirely.
     */
    type: 'delete',
    /**
     * The key to delete.
     */
    key: string
}
| {
    /**
     * Adds members to a set.
     */
    type: 'setAdd',
    /**
     * The key of the set.
     */
    key: string,
    /**
     * The members to add.
     */
    members: string[]
}
| {
    /**
     * Removes members from a set.
     */
    type: 'setRemove',
    /**
     * The key of the set.
     */
    key: string,
    /**
     * The members to remove.
     */
    members: string[]
};

/**
 * Takes a grant on one valkey key and keeps it alive until it is released.
 *
 * Supplied by the data source rather than built here, so the transaction does not have to know how a
 * grant is stored - only when to take one.
 */
export type ValKeyGrantProvider = (key: string) => Promise<KeptGrant>;

/**
 * A transaction of a valkey data source.
 *
 * Valkey has no interactive transactions: commands can only be queued and then applied in one atomic
 * batch (MULTI / EXEC). This transaction therefore buffers every write until it is committed and keeps
 * an overlay of the buffered state so that reads inside the transaction already see its own writes.
 *
 * That gives atomicity - either all buffered commands are applied or none of them are - and read your
 * own writes. Isolation from other writers comes from a grant per key, taken as the write is
 * buffered and held until the transaction ends, which is the same shape as a row lock: two
 * transactions writing the same key run one after the other, two writing different keys do not wait
 * for each other.
 *
 * Only writes that overwrite take a grant. `setAdd` and `setRemove` maintain the id indexes and
 * commute - two instances adding different ids to the same index cannot corrupt each other - so they
 * are left free, the same way a database does not hold an index locked for the length of a
 * transaction that inserted into it.
 *
 * Two differences from a real database remain, and neither is fixable here. Readers outside the
 * transaction are not blocked; they see the state from before the commit, because nothing is applied
 * until EXEC. And a cycle of transactions waiting on each other's keys is resolved by the acquisition
 * timing out rather than by being detected, so a deadlock costs the wait rather than being reported
 * the moment it forms.
 */
export class ValKeyTransaction implements Transaction {

    private readonly writes: ValKeyBufferedWrite[] = [];

    /**
     * The grants this transaction holds, keyed by the valkey key they cover.
     *
     * The promise rather than the grant, so two writes to the same key racing inside one transaction
     * wait on one acquisition instead of taking two grants and leaking one.
     */
    private readonly grants: Map<string, Promise<KeptGrant>> = new Map();

    /**
     * The hashes that have been written inside this transaction, keyed by their valkey key.
     */
    private readonly hashOverlay: Map<string, Record<string, string>> = new Map();

    /**
     * The hash fields that have been removed inside this transaction, keyed by their valkey key.
     *
     * Separate from the overlay because a removed field is not the same as a field written to
     * nothing: the overlay says what a key holds on top of what is stored, and this says what it
     * stops holding.
     */
    private readonly hashRemovals: Map<string, Set<string>> = new Map();

    /**
     * The set members that have been added inside this transaction, keyed by their valkey key.
     */
    private readonly setAdditions: Map<string, Set<string>> = new Map();

    /**
     * The set members that have been removed inside this transaction, keyed by their valkey key.
     */
    private readonly setRemovals: Map<string, Set<string>> = new Map();

    /**
     * The keys that have been deleted inside this transaction.
     */
    private readonly deleted: Set<string> = new Set();

    private finished: boolean = false;

    /**
     * Rolls the transaction back once nothing has happened on it for long enough.
     *
     * Armed by the first write rather than by the constructor, because a transaction that has not
     * written anything is holding nothing and costs nobody else anything.
     */
    private idleTimer: NodeJS.Timeout | undefined;

    constructor(
        private readonly client: GlideClient,
        private readonly acquireGrant: ValKeyGrantProvider,
        private readonly idleTimeoutInMs: number,
        private readonly logger: LoggerInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    get isFinished(): boolean {
        return this.finished;
    }

    /**
     * Buffers the given write and applies it to the overlay.
     *
     * Takes a grant on the key first when the write overwrites, and waits here if another
     * transaction holds it. That wait is the whole of the isolation: nothing is applied until the
     * commit, so without it two transactions would each buffer a write of the same key and the
     * later commit would silently win.
     * @param write - The write to buffer.
     * @throws When the transaction has already been committed or rolled back, or when the grant
     * could not be taken in time - which is also how a cycle of transactions waiting on each other
     * ends.
     */
    async add(write: ValKeyBufferedWrite): Promise<void> {
        if (this.finished) {
            throw new TransactionAlreadyFinishedError();
        }

        this.touch();
        if (write.type === 'hashSet' || write.type === 'hashDelete' || write.type === 'delete') {
            await this.claim(write.key);
        }

        // re-checked, because the grant above is awaited and the transaction may have been rolled
        // back while this was queueing for it - by another caller, or by the idle timeout above
        if (this.finished) {
            throw new TransactionAlreadyFinishedError();
        }
        // again, because taking the grant is itself a wait and the countdown covers what happens
        // after this write rather than what it took to get here
        this.touch();
        this.writes.push(write);

        switch (write.type) {
            case 'hashSet': {
                this.deleted.delete(write.key);
                // written after being removed means it is there again, so the removal stops applying
                const removed: Set<string> | undefined = this.hashRemovals.get(write.key);
                for (const field of Object.keys(write.values)) {
                    removed?.delete(field);
                }
                this.hashOverlay.set(write.key, { ...this.hashOverlay.get(write.key), ...write.values });
                return;
            }
            case 'hashDelete': {
                const removals: Set<string> = this.hashRemovals.get(write.key) ?? new Set();
                for (const field of write.fields) {
                    removals.add(field);
                }
                this.hashRemovals.set(write.key, removals);

                // a field written earlier in this transaction and removed now is simply gone, rather
                // than being written and then removed again on commit
                const buffered: Record<string, string> | undefined = this.hashOverlay.get(write.key);
                if (buffered) {
                    this.hashOverlay.set(
                        write.key,
                        Object.fromEntries(Object.entries(buffered).filter(([field]) => !removals.has(field)))
                    );
                }
                return;
            }
            case 'delete': {
                this.deleted.add(write.key);
                this.hashOverlay.delete(write.key);
                this.hashRemovals.delete(write.key);
                return;
            }
            case 'setAdd': {
                this.deleted.delete(write.key);
                const additions: Set<string> = this.setAdditions.get(write.key) ?? new Set();
                const removals: Set<string> | undefined = this.setRemovals.get(write.key);
                for (const member of write.members) {
                    additions.add(member);
                    removals?.delete(member);
                }
                this.setAdditions.set(write.key, additions);
                return;
            }
            case 'setRemove': {
                const removals: Set<string> = this.setRemovals.get(write.key) ?? new Set();
                const additions: Set<string> | undefined = this.setAdditions.get(write.key);
                for (const member of write.members) {
                    removals.add(member);
                    additions?.delete(member);
                }
                this.setRemovals.set(write.key, removals);
                return;
            }
        }
    }

    /**
     * Takes a grant on a key that this transaction is not itself writing.
     *
     * The one case that needs this is a read whose result decides what gets written - an upsert. The
     * grant that `add` takes is taken too late for that: by the time the write is known, the value it
     * was derived from has already been read, and another transaction may have written it since.
     * Claiming up front puts the read inside the protected window as well.
     *
     * The key does not have to hold anything. An upsert claims a key derived from the identity rather
     * than from a row, because the row it may be about to insert does not exist yet and has no key.
     * @param key - The key to hold until this transaction commits or rolls back.
     * @throws When the transaction has already been committed or rolled back.
     */
    async claimKey(key: string): Promise<void> {
        if (this.finished) {
            throw new TransactionAlreadyFinishedError();
        }
        this.touch();
        await this.claim(key);
        this.touch();
    }

    /**
     * Restarts the idle countdown, because something just happened on this transaction.
     *
     * Idle rather than age is what separates a transaction nobody is coming back to from a long one
     * that is still working: the long one keeps writing, and every write puts the full timeout back.
     */
    private touch(): void {
        if (!this.idleTimeoutInMs) {
            return;
        }
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => void this.abandon(), this.idleTimeoutInMs);
        // a transaction waiting to be given up on is not a reason to keep the process alive
        this.idleTimer.unref();
    }

    /**
     * Gives up on a transaction nothing has come back to, and hands back what it was holding.
     *
     * Reported rather than silent. Everything this transaction buffered is discarded, so the writes
     * a caller believed it had made are gone, and the only way anyone finds out is this line and the
     * TransactionAlreadyFinishedError that the next write on it throws.
     */
    private async abandon(): Promise<void> {
        if (this.finished) {
            return;
        }
        this.logger.error(new InternalError(
            `A transaction was left open for ${this.idleTimeoutInMs}ms without being committed or rolled back.`
            + ' It has been rolled back and the keys it held have been released.'
        ));

        try {
            await this.rollback();
        }
        catch (error) {
            // nothing is waiting on this - it runs on a timer rather than under a caller - so a
            // failure here has nowhere to be thrown to. Shutdown is the case that reaches it: the
            // client can be closing by the time the rollback goes to hand the grants back, and an
            // unhandled rejection would take the process down over a transaction already abandoned
            this.logger.error(error instanceof Error ? error : new InternalError(`${String(error)}`));
        }
    }

    /**
     * Takes a grant on the given key, unless this transaction already holds one.
     * @param key - The key about to be overwritten.
     * @returns The grant.
     */
    private async claim(key: string): Promise<KeptGrant> {
        const existing: Promise<KeptGrant> | undefined = this.grants.get(key);
        if (existing) {
            return await existing;
        }
        const grant: Promise<KeptGrant> = this.acquireGrant(key);
        // stored before it is awaited, so a second write to the same key joins this acquisition
        // rather than starting its own
        this.grants.set(key, grant);
        const res: KeptGrant = await grant;

        // the transaction can end while this is queueing for the grant, because the idle timeout
        // ends it from a timer rather than from whoever is writing. Everything it held was handed
        // back as it ended, and this arrived after that - so it is handed back here instead of
        // sitting in a map nothing comes back to, renewed for as long as the process lives
        if (this.finished) {
            this.grants.delete(key);
            await res.release();
        }
        return res;
    }

    /**
     * Hands every grant this transaction holds back.
     *
     * Runs however the transaction ended. A grant kept past the end of the transaction that took it
     * is the failure this whole area exists to prevent - and here it would be worse than usual,
     * because nothing would ever come back for it until it lapsed.
     */
    private async releaseGrants(): Promise<void> {
        // nothing left to give up on once the grants are going back
        clearTimeout(this.idleTimer);
        this.idleTimer = undefined;

        const pending: Promise<KeptGrant>[] = [...this.grants.values()];
        this.grants.clear();

        // settled, because an acquisition that failed has no grant to hand back and must not stop
        // the ones that succeeded from being released
        const grants: PromiseSettledResult<KeptGrant>[] = await Promise.allSettled(pending);
        await Promise.all(
            grants.map(async g => {
                if (g.status === 'fulfilled') {
                    await g.value.release();
                }
            })
        );
    }

    /**
     * Checks whether or not the given key has been deleted inside this transaction.
     * @param key - The key to check.
     * @returns True when the key has been deleted, false otherwise.
     */
    isDeleted(key: string): boolean {
        return this.deleted.has(key);
    }

    /**
     * Merges the buffered fields of this transaction into the given hash.
     * @param key - The key of the hash.
     * @param stored - The hash as it is currently stored on the server.
     * @returns The hash including everything that has been written inside this transaction,
     * or undefined when the key has been deleted inside this transaction.
     */
    resolveHash(key: string, stored: Record<string, string> | undefined): Record<string, string> | undefined {
        if (this.deleted.has(key)) {
            return undefined;
        }
        const buffered: Record<string, string> | undefined = this.hashOverlay.get(key);
        const removed: Set<string> | undefined = this.hashRemovals.get(key);
        if (!buffered && !removed?.size) {
            return stored;
        }
        // removing a field of a hash that is not there leaves nothing behind, rather than an empty
        // row that reads as existing
        if (stored == undefined && !buffered) {
            return undefined;
        }

        if (!removed?.size) {
            return { ...stored, ...buffered };
        }
        return Object.fromEntries(
            Object.entries({ ...stored, ...buffered }).filter(([field]) => !removed.has(field))
        );
    }

    /**
     * Merges the buffered members of this transaction into the given set members.
     * @param key - The key of the set.
     * @param stored - The members as they are currently stored on the server.
     * @returns The members including everything that has been written inside this transaction.
     */
    resolveSetMembers(key: string, stored: string[]): string[] {
        if (this.deleted.has(key)) {
            return [];
        }
        const res: Set<string> = new Set(stored);
        for (const member of this.setAdditions.get(key) ?? []) {
            res.add(member);
        }
        for (const member of this.setRemovals.get(key) ?? []) {
            res.delete(member);
        }
        return [...res];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async commit(): Promise<void> {
        if (this.finished) {
            throw new TransactionAlreadyFinishedError();
        }
        this.finished = true;

        try {
            await this.applyWrites();
        }
        finally {
            // after the batch, never before: the grants are what stopped anyone else writing these
            // keys, and letting go while the writes were still unapplied would be the same as never
            // having taken them
            await this.releaseGrants();
        }
    }

    /**
     * Applies everything this transaction buffered, in one atomic batch.
     * @throws When the batch could not be applied.
     */
    private async applyWrites(): Promise<void> {
        if (!this.writes.length) {
            return;
        }

        const batch: Batch = new (valKeyGlide().Batch)(true);
        for (const write of this.writes) {
            switch (write.type) {
                case 'hashSet': {
                    // eslint-disable-next-line cspell/spellchecker
                    batch.hset(write.key, write.values);
                    break;
                }
                case 'hashDelete': {
                    // eslint-disable-next-line cspell/spellchecker
                    batch.hdel(write.key, write.fields);
                    break;
                }
                case 'delete': {
                    batch.del([write.key]);
                    break;
                }
                case 'setAdd': {
                    // eslint-disable-next-line cspell/spellchecker
                    batch.sadd(write.key, write.members);
                    break;
                }
                case 'setRemove': {
                    // eslint-disable-next-line cspell/spellchecker
                    batch.srem(write.key, write.members);
                    break;
                }
            }
        }

        const res: unknown[] | null = await this.client.exec(batch, true);
        if (res == undefined) {
            throw new InternalError('The transaction could not be committed.');
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async rollback(): Promise<void> {
        this.finished = true;
        this.writes.length = 0;
        this.hashOverlay.clear();
        this.hashRemovals.clear();
        this.setAdditions.clear();
        this.setRemovals.clear();
        this.deleted.clear();
        await this.releaseGrants();
    }
}