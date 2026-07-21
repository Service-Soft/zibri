import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { type EventServiceInterface, EventSubscriptionInterface } from './event-service.interface';
import { EventSubscriberRun } from './event-subscriber-run.model';
import { Event, EventStatus } from './event.model';
import { EventSubscription } from './event.service';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { LoggerInterface } from '../logging/logger.interface';

async function waitUntil(predicate: () => Promise<boolean> | boolean, timeoutMs: number = 3000): Promise<void> {
    const start: number = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await predicate()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('waitUntil: condition was not met in time');
}

describe('EventService', () => {
    let server: StartedTestServer;
    let eventService: EventServiceInterface<Record<string, unknown>>;
    let eventRepo: Repository<Event<unknown>>;
    let eventSubscriberRunRepo: Repository<EventSubscriberRun<unknown>>;

    beforeAll(async () => {
        server = await startTestServer({});
        eventService = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);
        eventRepo = inject(repositoryTokenFor(Event));
        eventSubscriberRunRepo = inject(repositoryTokenFor(EventSubscriberRun));
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

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

        await waitUntil(() => received.length >= 2);
        expect(received).toEqual(expect.arrayContaining(['some.type', 'other.type']));

        sub.unsubscribe();
    });

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
            eventService.subscribeAll(() => undefined, { subscriberId: 'specific-then-all' })
        ).rejects.toThrow(/already subscribed to the events/);

        sub.unsubscribe();
    });

    it('throws when subscribing to a specific event type while already subscribed to "all"', async () => {
        const sub: EventSubscription = await eventService.subscribeAll(() => undefined, {
            subscriberId: 'all-then-specific'
        }) as EventSubscription;

        await expect(
            eventService.subscribe('some.other.event', () => undefined, { subscriberId: 'all-then-specific' })
        ).rejects.toThrow(/already subscribed to all events/);

        sub.unsubscribe();
    });

    it('retries a failing hook and clears the error once it eventually succeeds', async () => {
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

        await waitUntil(() => callCount >= 2);

        await waitUntil(async () => {
            const runs: EventSubscriberRun<unknown>[] = await eventSubscriberRunRepo.findAll({
                where: { subscriberId: 'retry-sub' }
            });
            return runs.length > 0;
        });

        const runs: EventSubscriberRun<unknown>[] = await eventSubscriberRunRepo.findAll({ where: { subscriberId: 'retry-sub' } });
        expect(runs).toHaveLength(1);
        expect(runs[0].error == undefined).toBe(true);

        sub.unsubscribe();
    });

    it('records an error and marks the run as failed when all attempts are exhausted', async () => {
        const sub: EventSubscription = await eventService.subscribe(
            'always-fails.event',
            () => {
                throw new Error('always fails');
            },
            { subscriberId: 'always-fails-sub', attempts: 2 }
        ) as EventSubscription;

        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        // eslint-disable-next-line typescript/typedef
        const errorSpy = jest.spyOn(logger, 'error');

        await eventService.emit('always-fails.event', { y: 1 });

        await waitUntil(async () => {
            const runs: EventSubscriberRun<unknown>[] = await eventSubscriberRunRepo.findAll({
                where: { subscriberId: 'always-fails-sub' }
            });
            return runs.length > 0;
        });

        const runs: EventSubscriberRun<unknown>[] = await eventSubscriberRunRepo.findAll({
            where: { subscriberId: 'always-fails-sub' }
        });
        expect(runs).toHaveLength(1);
        expect(runs[0].error).toBeDefined();
        expect(errorSpy).toHaveBeenCalled();

        sub.unsubscribe();
        errorSpy.mockRestore();
    });

    it('marks the event as FINISHED once every subscriber has run', async () => {
        const sub: EventSubscription = await eventService.subscribe('finish.event', () => undefined, {
            subscriberId: 'finish-sub'
        }) as EventSubscription;

        await eventService.emit('finish.event', { z: 1 });

        await waitUntil(async () => {
            const events: Event<unknown>[] = await eventRepo.findAll({ where: { type: 'finish.event' } });
            return events.length > 0 && events[0].status === EventStatus.FINISHED;
        });

        sub.unsubscribe();
    });

    it('unsubscribe stops the hook from being called for future events', async () => {
        let callCount: number = 0;
        const sub: EventSubscription = await eventService.subscribe(
            // eslint-disable-next-line cspell/spellchecker
            'unsub.event',
            () => {
                callCount++;
            },
            // eslint-disable-next-line cspell/spellchecker
            { subscriberId: 'unsub-sub' }
        ) as EventSubscription;

        sub.unsubscribe();
        // eslint-disable-next-line cspell/spellchecker
        await eventService.emit('unsub.event', { w: 1 });

        // give any (incorrect) async delivery a chance to happen
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(callCount).toBe(0);
    });
});