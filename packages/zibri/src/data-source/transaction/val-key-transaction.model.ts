import type { Batch, GlideClient } from '@valkey/valkey-glide';

import { applyGuardedValKeyWrites } from './apply-guarded-val-key-writes.function.ts';
import { KeyDeclarationsChangedError } from './key-declarations-changed.error.ts';
import { queueValKeyWrite } from './queue-val-key-write.function.ts';
import { TransactionAlreadyFinishedError } from './transaction-already-finished.error.ts';
import { Transaction } from './transaction.model.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { LoggerInterface } from '../../logging/logger.interface.ts';
import { valKeyGlide } from '../data-sources/val-key/val-key-glide.function.ts';

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
 * The grants of one transaction, kept alive and handed back together.
 *
 * Supplied by the data source rather than built here, so the transaction does not have to know how a
 * grant is stored - only when to take one.
 */
export type ValKeyTransactionGrants = {
    /**
     * Takes a grant on each of the keys in sorted order, queueing on each one while somebody else
     * holds it. A claim that completes after the grants were released hands its keys straight back.
     * @throws When a wait ran out, which is also how a deadlock ends.
     */
    claim: (keys: string[]) => Promise<void>,
    /**
     * Hands every grant back. Safe to call more than once.
     */
    release: () => Promise<void>
};

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
     * The claims this transaction made, keyed by the valkey key they cover.
     *
     * The promise rather than a flag, so two writes to the same key racing inside one transaction
     * wait on one acquisition instead of taking the key twice.
     */
    private readonly claims: Map<string, Promise<void>> = new Map();

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

    /**
     * The keys that have been deleted inside this transaction, whether or not they were written again
     * since - which means what is stored under them no longer counts, only what was written after.
     */
    private readonly replaced: Set<string> = new Set();

    /**
     * The value each guarded key was read with, by key, which it still has to hold when this commits.
     */
    private readonly guards: Map<string, string> = new Map();

    private finished: boolean = false;

    private readonly committedWork: (() => Promise<void>)[] = [];

    private readonly finishedWork: ((committed: boolean) => Promise<void>)[] = [];

    /**
     * Rolls the transaction back once nothing has happened on it for long enough.
     *
     * Armed by the first write rather than by the constructor, because a transaction that has not
     * written anything is holding nothing and costs nobody else anything.
     */
    private idleTimer: NodeJS.Timeout | undefined;

    constructor(
        private readonly client: GlideClient,
        private readonly grants: ValKeyTransactionGrants,
        private readonly idleTimeoutInMs: number,
        private readonly logger: LoggerInterface
    ) {}

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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
            await this.claim([write.key]);
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
                this.replaced.add(write.key);
                this.hashOverlay.delete(write.key);
                this.hashRemovals.delete(write.key);
                this.setAdditions.delete(write.key);
                this.setRemovals.delete(write.key);
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
     * Takes a grant on keys before anything is written to them.
     *
     * The case that needs this is a read whose result decides what gets written - an upsert, or the
     * stored row a save compares against. The grant that `add` takes is taken too late for that: by
     * the time the write is known, the value it was derived from has already been read, and another
     * transaction may have written it since. Claiming up front puts the read inside the protected
     * window as well. It is also the cheaper way to take many: all of them in one claim rather than one
     * claim per write.
     *
     * A key does not have to hold anything. An upsert claims a key derived from the identity rather
     * than from a row, because the row it may be about to insert does not exist yet and has no key.
     * @param keys - The keys to hold until this transaction commits or rolls back. Taken in sorted
     * order, whatever order they are given in.
     * @throws When the transaction has already been committed or rolled back.
     */
    async claimKeys(keys: string[]): Promise<void> {
        if (this.finished) {
            throw new TransactionAlreadyFinishedError();
        }
        this.touch();
        await this.claim(keys);
        this.touch();
    }

    /**
     * Makes the commit depend on a key still holding the value it was read with.
     *
     * For a value some of the buffered writes were worked out from, which other instances may change
     * meanwhile without holding anything this transaction would wait on. The commit then applies
     * nothing when it has changed, rather than writes derived from a value that no longer holds.
     * @param key - The key that was read.
     * @param value - What it held, an empty string when it did not exist.
     * @throws KeyDeclarationsChangedError when the transaction already read the key and found something
     * else, since writes derived from both cannot all be right.
     */
    guardKey(key: string, value: string): void {
        if (this.finished) {
            throw new TransactionAlreadyFinishedError();
        }
        const guarded: string | undefined = this.guards.get(key);
        if (guarded != undefined && guarded !== value) {
            throw new KeyDeclarationsChangedError();
        }
        this.guards.set(key, value);
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
     * Takes a grant on each of the given keys this transaction does not already hold.
     *
     * A claim still queueing when the transaction ends hands its keys back itself once they are
     * granted, rather than leaving them held with nothing coming back for them - which `grants` takes
     * care of.
     * @param keys - The keys about to be overwritten.
     */
    private async claim(keys: string[]): Promise<void> {
        const pending: Promise<void>[] = [];
        const unclaimed: string[] = [];
        for (const key of new Set(keys)) {
            const existing: Promise<void> | undefined = this.claims.get(key);
            if (existing) {
                pending.push(existing);
                continue;
            }
            unclaimed.push(key);
        }
        if (unclaimed.length) {
            const claim: Promise<void> = this.grants.claim(unclaimed);
            // stored before it is awaited, so a second write to one of these keys joins this
            // acquisition rather than starting its own
            for (const key of unclaimed) {
                this.claims.set(key, claim);
            }
            pending.push(claim);
        }
        await Promise.all(pending);
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
        this.claims.clear();
        // together rather than one by one, because a transaction holds as many grants as it wrote
        // rows - and without waiting for claims still queueing, which hand their key back on their own
        await this.grants.release();
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
        // a key deleted and written again holds what was written since, which the commit applies
        // after deleting it - so none of the fields stored before
        const kept: Record<string, string> | undefined = this.replaced.has(key) ? undefined : stored;
        const buffered: Record<string, string> | undefined = this.hashOverlay.get(key);
        const removed: Set<string> | undefined = this.hashRemovals.get(key);
        if (!buffered && !removed?.size) {
            return kept;
        }
        // removing a field of a hash that is not there leaves nothing behind, rather than an empty
        // row that reads as existing
        if (kept == undefined && !buffered) {
            return undefined;
        }

        if (!removed?.size) {
            return { ...kept, ...buffered };
        }
        return Object.fromEntries(
            Object.entries({ ...kept, ...buffered }).filter(([field]) => !removed.has(field))
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
        // for the reason a hash does
        const res: Set<string> = new Set(this.replaced.has(key) ? [] : stored);
        for (const member of this.setAdditions.get(key) ?? []) {
            res.add(member);
        }
        for (const member of this.setRemovals.get(key) ?? []) {
            res.delete(member);
        }
        return [...res];
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async commit(): Promise<void> {
        if (this.finished) {
            throw new TransactionAlreadyFinishedError();
        }
        this.finished = true;

        let committed: boolean = false;
        try {
            await this.applyWrites();
            committed = true;
        }
        finally {
            // after the batch, never before: the grants are what stopped anyone else writing these
            // keys, and letting go while the writes were still unapplied would be the same as never
            // having taken them
            await this.releaseGrants();
            await this.runFinishedWork(committed);
        }
        for (const work of this.committedWork.splice(0)) {
            await work();
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    afterCommit(work: () => Promise<void>): void {
        this.committedWork.push(work);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    afterFinish(work: (committed: boolean) => Promise<void>): void {
        this.finishedWork.push(work);
    }

    /**
     * Runs the work waiting for the end of the transaction.
     * @param committed - Whether the transaction was committed.
     */
    private async runFinishedWork(committed: boolean): Promise<void> {
        // spliced, so a rollback after a failed commit does not run it a second time
        for (const work of this.finishedWork.splice(0)) {
            await work(committed);
        }
    }

    /**
     * Applies everything this transaction buffered, in one atomic batch.
     * @throws KeyDeclarationsChangedError when a guarded key changed, in which case nothing was applied.
     * @throws When the batch could not be applied.
     */
    private async applyWrites(): Promise<void> {
        if (!this.writes.length) {
            return;
        }
        if (this.guards.size) {
            if (!await applyGuardedValKeyWrites(this.client, this.guards, this.writes)) {
                throw new KeyDeclarationsChangedError();
            }
            return;
        }

        const batch: Batch = new (valKeyGlide().Batch)(true);
        for (const write of this.writes) {
            queueValKeyWrite(batch, write);
        }

        const res: unknown[] | null = await this.client.exec(batch, true);
        if (res == undefined) {
            throw new InternalError('The transaction could not be committed.');
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async rollback(): Promise<void> {
        this.finished = true;
        this.writes.length = 0;
        this.hashOverlay.clear();
        this.hashRemovals.clear();
        this.setAdditions.clear();
        this.setRemovals.clear();
        this.deleted.clear();
        this.replaced.clear();
        this.guards.clear();
        this.committedWork.length = 0;
        await this.releaseGrants();
        await this.runFinishedWork(false);
    }
}