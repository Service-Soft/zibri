import assert from 'node:assert';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { type EventServiceInterface, EventSubscriptionInterface } from './event-service.interface';
import { EventSubscriberRegistration, EventSubscriberRegistrationCreateData } from './event-subscriber-registration.model';
import { EventSubscriberRun, EventSubscriberRunStatus } from './event-subscriber-run.model';
import { Event, EventStatus } from './event.model';
import { EventSubscription } from './event.service';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { startAndStopTestServerWithout } from '../__testing__/test-server/start-and-stop-test-server-without.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../__testing__/wait-until.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { LoggerInterface } from '../logging/logger.interface';
import { Ms } from '../utilities/ms';

/**
 * The payload of an event whose scenario is about delivery rather than about content.
 *
 * Each of them carries one counter, so that a hook can tell two deliveries apart without the
 * scenario having to be about what an event holds.
 */
type MarkerPayload = Record<string, number>;

declare module './event-service.interface' {
    /**
     * What this suite emits, declared the way an application declares its own events.
     *
     * The map is what makes `emit` refuse a type nobody declared and hands a hook the payload
     * belonging to the type it named. Every entry here is one scenario below.
     */
    interface ZibriEventMap {
        /**
         * The plain case: a payload arrives at a hook typed for it.
         */
        'user.created': { userId: string },
        /**
         * Emitted with no subscriber for it, to show a hook for another type stays untouched.
         */
        'some.other.event': MarkerPayload,
        /**
         * A hook that throws every attempt, to show the run ends FAILED rather than FINISHED.
         */
        'always-fails.event': MarkerPayload,
        /**
         * The remaining scenarios, none of which look at what they carry.
         */
        'some.type': MarkerPayload,
        'other.type': MarkerPayload,
        'specific.event': MarkerPayload,
        'unsubscribed.event': MarkerPayload,
        'dup.event': MarkerPayload,
        'retry.event': MarkerPayload,
        'finish.event': MarkerPayload,
        'lapse.event': MarkerPayload,
        'burst.event': MarkerPayload
    }
}

/**
 * How many hooks this instance is allowed to be running at once, for the test that watches it.
 */
const maxConcurrentHooks: number = 2;

// first, for the reason on startAndStopTestServerWithout
describe('EventService — starting', () => {
    it('refuses to start without its entities, and names all three', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([Event, EventSubscriberRun, EventSubscriberRegistration]);

        await expect(start).rejects.toThrow('Error initializing EventService');
        await expect(start).rejects.toThrow(/Event[\S\s]*EventSubscriberRun[\S\s]*EventSubscriberRegistration/);
    }, 30000);

    it('refuses to start without saying how long a failed event is kept', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([], {
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS, useValue: undefined })
            ]
        });

        await expect(start).rejects.toThrow('ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS');
    }, 30000);
});

describe('EventService', () => {
    let server: StartedTestServer;
    let eventService: EventServiceInterface;
    let eventRepo: Repository<Event<unknown>>;
    let eventSubscriberRunRepo: Repository<EventSubscriberRun<unknown>>;
    let registrationRepo: Repository<EventSubscriberRegistration, EventSubscriberRegistrationCreateData>;

    beforeAll(async () => {
        // the real defaults are a minute each, which is the right cadence for a downed dependency
        // and far too long to wait for here. Both matter: an attempt keeps its grant until the lease
        // lapses, so the delay alone would not bring the retry any closer.
        server = await startTestServer({
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_EXECUTION_LEASE_IN_MS, useValue: 300 }),
                defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_RETRY_DELAY_IN_MS, useValue: 300 }),
                // two, so that "more than the limit" is a burst of a handful rather than of fifty
                defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_MAX_CONCURRENT_HOOKS, useValue: maxConcurrentHooks })
            ]
        });
        eventService = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);
        eventRepo = inject(repositoryTokenFor(Event));
        eventSubscriberRunRepo = inject(repositoryTokenFor(EventSubscriberRun));
        registrationRepo = inject(repositoryTokenFor(EventSubscriberRegistration));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    // a registration outlives the subscription that created it on purpose: unsubscribing here is one
    // process letting go, and any other instance still hosting that subscriber refreshes the row, so
    // it lapses after its ttl rather than being deleted. Every test below uses a subscriber id of its
    // own, so without this each emit counts every earlier test's subscriber as still owing it a run
    // and no event ever finishes - for a whole minute, which is longer than any of them wait.
    beforeEach(async () => {
        await registrationRepo.deleteAll({});
    });

    it('calls a subscribed hook with the emitted event data', async () => {
        const received: unknown[] = [];
        const sub: EventSubscriptionInterface = await eventService.subscribe(
            'user.created',
            (event) => {
                received.push(event.data);
            },
            { subscriberId: 'test-sub-1' }
        );

        await eventService.emit('user.created', { userId: '42' });

        await waitUntil(() => received.length > 0);
        expect(received[0]).toEqual({ userId: '42' });

        sub.unsubscribe();
    });

    it('calls a subscribeAll hook regardless of event type', async () => {
        const received: string[] = [];
        const sub: EventSubscriptionInterface = await eventService.subscribeAll(
            (event) => {
                received.push(event.type);
            },
            { subscriberId: 'test-sub-all' }
        );

        await eventService.emit('some.type', { a: 1 });
        await eventService.emit('other.type', { b: 2 });

        // dispatched as the poll would: a hook of the test before can still be recording its run, and
        // with it the two hooks here are one more than this suite allows at once, so the second is
        // left for the poll - which the test server does not run
        await waitUntil(async () => {
            await eventService.dispatchPending();
            return received.length >= 2;
        });
        expect(received).toEqual(expect.arrayContaining(['some.type', 'other.type']));

        sub.unsubscribe();
    }, 10000);

    it('warns and returns the existing subscription for a duplicate subscriberId on the same event type', async () => {
        const first: EventSubscription = await eventService.subscribe('dup.event', () => undefined, {
            subscriberId: 'dup-sub'
        }) as EventSubscription;

        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        // eslint-disable-next-line typescript/typedef
        const warnSpy = jest.spyOn(logger, 'warn');

        const second: EventSubscription = await eventService.subscribe('dup.event', () => undefined, {
            subscriberId: 'dup-sub'
        }) as EventSubscription;

        expect(second).toBe(first);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('already subscribed to this event'));

        first.unsubscribe();
        warnSpy.mockRestore();
    });

    it('throws when subscribing to "all" while already subscribed to a specific event type', async () => {
        const sub: EventSubscription = await eventService.subscribe('specific.event', () => undefined, {
            subscriberId: 'specific-then-all'
        }) as EventSubscription;

        await expect(
            async () => await eventService.subscribeAll(() => undefined, { subscriberId: 'specific-then-all' })
        ).rejects.toThrow(/already subscribed to the events/);

        sub.unsubscribe();
    });

    it('throws when subscribing to a specific event type while already subscribed to "all"', async () => {
        const sub: EventSubscription = await eventService.subscribeAll(() => undefined, {
            subscriberId: 'all-then-specific'
        }) as EventSubscription;

        await expect(
            async () => await eventService.subscribe('some.other.event', () => undefined, { subscriberId: 'all-then-specific' })
        ).rejects.toThrow(/already subscribed to all events/);

        sub.unsubscribe();
    });

    it('spends one attempt per delivery and clears the error once a later one succeeds', async () => {
        let callCount: number = 0;
        const sub: EventSubscription = await eventService.subscribe(
            'retry.event',
            () => {
                callCount++;
                if (callCount < 2) {
                    throw new Error('fails on first attempt');
                }
            },
            { subscriberId: 'retry-sub', attempts: 3 }
        ) as EventSubscription;

        await eventService.emit('retry.event', { x: 1 });

        // one attempt, then a state that says another is owed. The loop this replaces spent all
        // three within microseconds, which is no use at all against a dependency that needs a
        // moment to come back.
        await waitUntil(async () => {
            const [run]: EventSubscriberRun<unknown>[] = await eventSubscriberRunRepo.findAll({
                where: { subscriberId: 'retry-sub' }
            });
            return run?.status === EventSubscriberRunStatus.PENDING_RETRY;
        });
        const [pending]: EventSubscriberRun<unknown>[] = await eventSubscriberRunRepo.findAll({
            where: { subscriberId: 'retry-sub' }
        });
        assert(pending, 'no run was recorded for retry-sub');
        expect(pending.attempts).toBe(1);
        expect(pending.error).toBeDefined();
        expect(pending.nextRetryAt?.getTime()).toBeGreaterThan(Date.now());
        expect(callCount).toBe(1);

        // and the event is not offered to it again while the backoff is still running
        await eventService.dispatchPending();
        expect(callCount).toBe(1);

        await waitUntil(async () => {
            await eventService.dispatchPending();
            return callCount >= 2;
        }, 10000);

        await waitUntil(async () => {
            const [run]: EventSubscriberRun<unknown>[] = await eventSubscriberRunRepo.findAll({
                where: { subscriberId: 'retry-sub' }
            });
            return run?.status === EventSubscriberRunStatus.SUCCEEDED;
        });
        const [succeeded]: EventSubscriberRun<unknown>[] = await eventSubscriberRunRepo.findAll({
            where: { subscriberId: 'retry-sub' }
        });
        assert(succeeded, 'no run was recorded for retry-sub');
        expect(succeeded.attempts).toBe(2);
        expect(succeeded.error == undefined).toBe(true);
        expect(succeeded.nextRetryAt == undefined).toBe(true);

        sub.unsubscribe();
    }, 20000);

    it('fails the event rather than finishing it when a subscriber spends every attempt', async () => {
        let callCount: number = 0;
        const sub: EventSubscription = await eventService.subscribe(
            'always-fails.event',
            () => {
                callCount++;
                throw new Error('always fails');
            },
            { subscriberId: 'always-fails-sub', attempts: 2 }
        ) as EventSubscription;

        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        // eslint-disable-next-line typescript/typedef
        const errorSpy = jest.spyOn(logger, 'error');

        await eventService.emit('always-fails.event', { y: 1 });

        await waitUntil(async () => {
            await eventService.dispatchPending();
            const [run]: EventSubscriberRun<unknown>[] = await eventSubscriberRunRepo.findAll({
                where: { subscriberId: 'always-fails-sub' }
            });
            return run?.status === EventSubscriberRunStatus.FAILED;
        }, 10000);

        const [run]: EventSubscriberRun<unknown>[] = await eventSubscriberRunRepo.findAll({
            where: { subscriberId: 'always-fails-sub' }
        });
        assert(run, 'no run was recorded for always-fails-sub');
        expect(run.attempts).toBe(2);
        expect(run.nextRetryAt == undefined).toBe(true);
        // readable and not merely present: an Error's message and stack are not enumerable, so the
        // column would keep `{}` of one - a row saying a failure happened and nothing about what it
        // was, which is no better than the row that used to say it had succeeded
        expect(run.error?.paragraphs.join('\n')).toContain('always fails');

        // the whole of the finding: a subscriber that never succeeded used to leave the event
        // FINISHED, which is the one status the cleanup job deletes - so the record of work that
        // was owed and never done was thrown away a day later.
        //
        // Waited for rather than read straight away, because the run row is written first and the
        // event settled right after it, so the loop above can see the run before the event catches
        // up. Deliberately without a dispatch: the poll settles events too, and this is about the
        // subscriber's own last attempt doing it.
        await waitUntil(async () => {
            const [settled]: Event<unknown>[] = await eventRepo.findAll({ where: { type: 'always-fails.event' } });
            return settled?.status === EventStatus.FAILED;
        });
        const [event]: Event<unknown>[] = await eventRepo.findAll({ where: { type: 'always-fails.event' } });
        assert(event, 'the event was not recorded');
        expect(event.status).toBe(EventStatus.FAILED);
        expect(errorSpy).toHaveBeenCalled();

        // and giving up is an ending: a failed event is not handed back out, or a subscriber that
        // cannot succeed would be retried for as long as the row exists
        const spentAttempts: number = callCount;
        await eventService.dispatchPending();
        await eventService.dispatchPending();
        expect(callCount).toBe(spentAttempts);

        sub.unsubscribe();
        errorSpy.mockRestore();
    }, 20000);

    it('marks the event as FINISHED once every subscriber has run', async () => {
        const sub: EventSubscription = await eventService.subscribe('finish.event', () => undefined, {
            subscriberId: 'finish-sub'
        }) as EventSubscription;

        await eventService.emit('finish.event', { z: 1 });

        // dispatched as the poll would, for the reason the subscribeAll case gives: hooks of the tests
        // before can still be running, and a hook over the limit waits for the poll
        await waitUntil(async () => {
            await eventService.dispatchPending();
            const events: Event<unknown>[] = await eventRepo.findAll({ where: { type: 'finish.event' } });
            return events[0]?.status === EventStatus.FINISHED;
        });

        sub.unsubscribe();
    });

    it('finishes an event once the last subscriber owing it a run has lapsed', async () => {
        const registration: EventSubscriberRegistration = await registrationRepo.create({
            subscriberId: 'lapsing-sub',
            eventType: 'lapse.event',
            expiresAt: new Date(Date.now() + Ms.MINUTE)
        });

        // registered but not subscribed here: the subscriber lives on another instance, so nothing
        // in this process can record its run
        await eventService.emit('lapse.event', { q: 1 });
        const emittedEvents: Event<unknown>[] = await eventRepo.findAll({ where: { type: 'lapse.event' } });
        expect(emittedEvents).toHaveLength(1);
        const [emitted]: Event<unknown>[] = emittedEvents;
        assert(emitted, 'the event was not recorded');
        expect(emitted.subscriberIds).toEqual(['lapsing-sub']);

        // while the registration lives the event has to stay open - the instance hosting the
        // subscriber may just be restarting, and finishing it now would mean it never arrives
        await eventService.dispatchPending();
        expect((await eventRepo.findById(emitted.id)).status).not.toBe(EventStatus.FINISHED);

        // the last instance hosting it goes away, so nothing refreshes the row any more
        await registrationRepo.updateById(registration.id, { expiresAt: new Date(Date.now() - Ms.MINUTE) });

        // nobody owes the event a run any more. Only the dispatch poll can notice that: no hook will
        // ever run for this event again, so the finish check that follows a hook is never reached
        await eventService.dispatchPending();
        expect((await eventRepo.findById(emitted.id)).status).toBe(EventStatus.FINISHED);
    });

    it('runs no more hooks at once than it is allowed to, and comes back for the rest', async () => {
        let running: number = 0;
        let peak: number = 0;
        let release: () => void = () => undefined;
        const held: Promise<void> = new Promise<void>(resolve => {
            release = resolve;
        });

        await eventService.subscribe(
            'burst.event',
            async () => {
                running++;
                peak = Math.max(peak, running);
                await held;
                running--;
            },
            { subscriberId: 'burst-sub', timeout: Ms.SECOND * 10 }
        );

        const burst: number = 8;
        for (let i: number = 0; i < burst; i++) {
            await eventService.emit('burst.event', { i });
        }

        // every one of these arrived while the ones before it were still running, so without a limit
        // all eight are in flight at once - each holding a timeout timer, a claim being renewed and
        // a row to write. That is the shape a burst of fifty thousand takes as well.
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(peak).toBeLessThanOrEqual(maxConcurrentHooks);
        expect(peak).toBeGreaterThan(0);

        // nothing was dropped by refusing to start it. The event is still owed, and the poll is what
        // brings it back - which is the only reason refusing is allowed to be the answer
        release();
        await waitUntil(async () => {
            await eventService.dispatchPending();
            const runs: EventSubscriberRun<unknown>[] = await eventSubscriberRunRepo.findAll({
                where: { subscriberId: 'burst-sub', status: EventSubscriberRunStatus.SUCCEEDED }
            });
            return runs.length === burst;
        }, 15000);
    }, 30000);

    it('unsubscribe stops the hook from being called for future events', async () => {
        let callCount: number = 0;
        const sub: EventSubscription = await eventService.subscribe(
            'unsubscribed.event',
            () => {
                callCount++;
            },
            { subscriberId: 'unsubscribed-sub' }
        ) as EventSubscription;

        sub.unsubscribe();
        await eventService.emit('unsubscribed.event', { w: 1 });

        // give any (incorrect) async delivery a chance to happen
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(callCount).toBe(0);
    });
});