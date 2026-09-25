import { setTimeout } from 'node:timers/promises';

import { RateLimitStateEntity } from './rate-limit-state-entity.model';
import { RateLimiterLockInterface } from './rate-limiter-lock.interface';
import { BaseRateLimitState, RateLimiterStoreInterface, RateLimiterStoreUpdateResult } from './rate-limiter-store.interface';
import { Repository } from '../../data-source/repository/repository';
import { UniqueConstraintViolationError } from '../../data-source/unique-constraint-violation.error';
import { InternalError } from '../../error-handling/internal-error.model';

/**
 * How often a write that lost its compare and set is retried before giving up.
 *
 * Losing one means another instance wrote between this one's read and its write, which the lock is
 * there to prevent - so it happens only when the lock expired under a slow section. Giving up
 * eventually is right; giving up early is what turns contention into a failed request.
 */
const maxWriteAttempts: number = 8;

/**
 * The longest the first backoff can be, doubling for each attempt after it.
 *
 * Retrying immediately is what makes losing repeatedly likely: every writer that lost did so at the
 * same moment, so retrying at the same moment puts them straight back into the same race. The wait
 * is a random point in the window rather than the window itself - a fixed delay moves the collision
 * rather than breaking it up.
 */
const backoffBaseInMs: number = 5;

/**
 * A rate limiter store that keeps its state in a data source, which makes the limits work across
 * multiple instances of an app.
 *
 * Because it goes through a repository it works with every data source, so the same limits can be
 * backed by valkey or by postgres without changing anything but the repository that is injected.
 *
 * ## Expiry
 * Expired states are treated as absent as soon as they are read, exactly like the
 * InMemoryRateLimiterStore does it. Removing them is the job of the rate limiting cleanup cron job,
 * nothing here depends on them being gone.
 *
 * ## Atomicity
 * Reading the state, running the updater and writing the result are separate operations, so two
 * things guard them. A lock keeps concurrent updates of one key from happening at the same time, see
 * {@link RateLimiterLockInterface}. The row's `version` keeps a write that happened anyway from being
 * silently lost: it is compared as part of the write, so the second writer is refused and retries
 * against what the first one left behind. The lock is what makes that rare; the version is what makes
 * it correct.
 */
export class RepositoryRateLimiterStore<TState extends BaseRateLimitState> implements RateLimiterStoreInterface<TState> {

    constructor(
        private readonly repository: Repository<RateLimitStateEntity>,
        private readonly lock: RateLimiterLockInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async atomicUpdate(key: string, updater: (current: TState | undefined) => TState): Promise<RateLimiterStoreUpdateResult<TState>> {
        for (let attempt: number = 0; attempt < maxWriteAttempts; attempt++) {
            const res: RateLimiterStoreUpdateResult<TState> | undefined = await this.lock.withLock(
                key,
                async () => await this.tryUpdate(key, updater)
            );
            if (res) {
                return res;
            }
            await this.backOff(attempt);
        }
        throw new InternalError(
            `The rate limit "${key}" was written by another instance ${maxWriteAttempts} times in a row.`
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async get(key: string): Promise<TState | undefined> {
        return this.toState(await this.repository.findOne({ where: { key }, required: false }));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async delete(key: string): Promise<void> {
        await this.repository.deleteAll({ key });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteExpired(now: number): Promise<void> {
        await this.repository.deleteAll({ expiresAtMs: { lesserThanEquals: now } });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async keysWithExpiredReservations(now: number): Promise<string[]> {
        const rows: RateLimitStateEntity[] = await this.repository.findAll({
            // every key with something expired on it - the ones left out would keep their expired
            // reservations until some later pass happened to include them
            take: 'all',
            where: {
                expiresAtMs: { greaterThan: now },
                nextReservationExpiryMs: { lesserThanEquals: now }
            }
        });
        return rows.map(r => r.key);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async getAll(): Promise<TState[]> {
        return (await this.readUnexpired()).map(e => e.state as TState);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async keys(): Promise<string[]> {
        return (await this.readUnexpired()).map(e => e.key);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async size(): Promise<number> {
        return (await this.readUnexpired()).length;
    }

    /**
     * Waits a random moment before trying the write again.
     *
     * A random point inside a doubling window, which is what breaks a pile-up apart: the writers
     * that lost this round all lost at the same instant, so any wait they share puts them back into
     * the same race. Nothing here needs to be precise - it only has to make two writers unlikely to
     * pick the same moment twice.
     * @param attempt - How many attempts have already been spent.
     */
    private async backOff(attempt: number): Promise<void> {
        await setTimeout(Math.random() * backoffBaseInMs * (2 ** attempt));
    }

    /**
     * One read modify write cycle, refused rather than applied when the row changed underneath it.
     * @param key - The rate limit key.
     * @param updater - Receives the current state and returns the next one.
     * @returns The result, or undefined when another writer got there first and this has to start over.
     */
    private async tryUpdate(
        key: string,
        updater: (current: TState | undefined) => TState
    ): Promise<RateLimiterStoreUpdateResult<TState> | undefined> {
        const existing: RateLimitStateEntity | undefined = await this.repository.findOne({ where: { key }, required: false });
        const current: TState | undefined = this.toState(existing);
        const next: TState = updater(current);

        if (existing) {
            // the version is part of the filter rather than checked beforehand, so nothing can write
            // between the check and this. Exactly one of two concurrent writers gets a row back
            const updated: number = await this.repository.updateAll(
                { key, version: existing.version },
                {
                    expiresAtMs: next.expiresAtMs,
                    nextReservationExpiryMs: this.nextReservationExpiryMs(next),
                    version: existing.version + 1,
                    state: next
                }
            );
            return updated ? { value: next, sizeChanged: current == undefined } : undefined;
        }

        try {
            await this.repository.create({
                key,
                expiresAtMs: next.expiresAtMs,
                nextReservationExpiryMs: this.nextReservationExpiryMs(next),
                version: 0,
                state: next
            });
        }
        catch (error) {
            // the key is unique and the row has no other constraint, so the only thing that refusal
            // can mean is the same key being created by someone else. Same answer as a lost compare
            // and set: read what they wrote and run the updater against that.
            //
            // Asked for by name rather than caught wholesale, because everything else a store can
            // fail with - being unreachable, being out of space - is not contention and retrying it
            // twice more only turns the real cause into "written by another instance 3 times".
            if (!(error instanceof UniqueConstraintViolationError)) {
                throw error;
            }
            return undefined;
        }
        return { value: next, sizeChanged: true };
    }

    /**
     * When the earliest still open reservation of a state expires.
     * @param state - The state about to be written.
     * @returns The timestamp, or undefined while the state holds no reservations.
     */
    private nextReservationExpiryMs(state: TState): number | undefined {
        if (!state.reservations.length) {
            return undefined;
        }
        return Math.min(...state.reservations.map(r => r.expiresAtMs));
    }

    private async readUnexpired(): Promise<RateLimitStateEntity[]> {
        // one row per limited key, and the answer is about all of them
        return await this.repository.findAll({ take: 'all', where: { expiresAtMs: { greaterThan: Date.now() } } });
    }

    /**
     * Reads the state of an entity, treating an expired one as if it was not there.
     * @param entity - The entity that was found, if any.
     * @returns The state, or undefined when there is none or it has expired.
     */
    private toState(entity: RateLimitStateEntity | undefined): TState | undefined {
        if (entity == undefined || entity.expiresAtMs <= Date.now()) {
            return undefined;
        }
        return entity.state as TState;
    }
}