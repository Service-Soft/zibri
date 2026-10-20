import assert from 'node:assert';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { type EventServiceInterface, EventSubscriptionInterface } from './event-service.interface.ts';
import { EventSubscriberRegistration, EventSubscriberRegistrationCreateData } from './event-subscriber-registration.model.ts';
import { EventSubscriberRun, EventSubscriberRunStatus } from './event-subscriber-run.model.ts';
import { Event, EventStatus } from './event.model.ts';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { waitUntil } from '../__testing__/wait-until.function.ts';
import { Repository } from '../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { defineProvider } from '../di/models/di-provider.model.ts';

declare module './event-service.interface.ts' {
    /**
     * What this suite emits, one type per scenario.
     */
    interface ZibriEventMap {
        'replay.fixed': Record<string, number>,
        'replay.first': Record<string, number>,
        'replay.second': Record<string, number>,
        'replay.lapsed': Record<string, number>
    }
}

// in memory, so that a replay can be watched without a container
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

describe('EventService replaying failed runs', () => {
    let server: StartedTestServer;
    let eventService: EventServiceInterface;
    let eventRepo: Repository<Event<unknown>>;
    let runRepo: Repository<EventSubscriberRun<unknown>>;
    let registrationRepo: Repository<EventSubscriberRegistration, EventSubscriberRegistrationCreateData>;

    /**
     * Subscribes a hook that throws every time it runs.
     * @param type - The event type.
     * @param subscriberId - The subscriber.
     * @returns The subscription.
     */
    async function subscribeFailing(
        type: 'replay.first' | 'replay.second' | 'replay.lapsed',
        subscriberId: string
    ): Promise<EventSubscriptionInterface> {
        return await eventService.subscribe(type, () => {
            throw new Error('always fails');
        }, { subscriberId });
    }

    /**
     * Waits until every event of the type has settled as failed.
     * @param type - The event type.
     * @param count - How many events of the type there are.
     * @returns The events.
     */
    async function waitForFailedEvents(type: string, count: number): Promise<Event<unknown>[]> {
        await waitUntil(async () => {
            const events: Event<unknown>[] = await eventRepo.findAll({ where: { type } });
            return events.length === count && events.every(e => e.status === EventStatus.FAILED);
        });
        return await eventRepo.findAll({ where: { type } });
    }

    beforeAll(async () => {
        // short, for the reason event.service.test.ts gives: an attempt keeps its grant until the
        // lease lapses, so a replayed run is not run again before then
        server = await startTestServer({
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_EXECUTION_LEASE_IN_MS, useValue: 300 }),
                defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_RETRY_DELAY_IN_MS, useValue: 300 })
            ]
        });
        eventService = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);
        eventRepo = inject(repositoryTokenFor(Event));
        runRepo = inject(repositoryTokenFor(EventSubscriberRun));
        registrationRepo = inject(repositoryTokenFor(EventSubscriberRegistration));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    // for the reason event.service.test.ts gives: a registration outlives its subscription
    beforeEach(async () => {
        await registrationRepo.deleteAll({});
    });

    it('offers a failed run again with all of its attempts, and finishes the event once it succeeds', async () => {
        let calls: number = 0;
        let succeedsFromCall: number = Number.POSITIVE_INFINITY;
        const sub: EventSubscriptionInterface = await eventService.subscribe('replay.fixed', () => {
            calls++;
            if (calls < succeedsFromCall) {
                throw new Error('not fixed yet');
            }
        }, { subscriberId: 'replay-fixed', attempts: 2 });

        await eventService.emit('replay.fixed', { n: 1 });
        await waitUntil(async () => {
            await eventService.dispatchPending();
            return (await eventRepo.findAll({ where: { type: 'replay.fixed' } }))[0]?.status === EventStatus.FAILED;
        }, 10000);
        expect(calls).toBe(2);

        // fails once more and succeeds on the attempt after: a replay that gave a single attempt
        // would end FAILED again here
        succeedsFromCall = calls + 2;
        expect(await eventService.replayFailed({ subscriberIds: ['replay-fixed'] })).toBe(1);

        const [replayed]: EventSubscriberRun<unknown>[] = await runRepo.findAll({ where: { subscriberId: 'replay-fixed' } });
        assert(replayed, 'no run was recorded for replay-fixed');
        expect(replayed.status).toBe(EventSubscriberRunStatus.PENDING_RETRY);
        expect(replayed.attempts).toBe(0);
        expect((await eventRepo.findAll({ where: { type: 'replay.fixed' } }))[0]?.status).toBe(EventStatus.CREATED);

        await waitUntil(async () => {
            await eventService.dispatchPending();
            return (await eventRepo.findAll({ where: { type: 'replay.fixed' } }))[0]?.status === EventStatus.FINISHED;
        }, 10000);
        const [succeeded]: EventSubscriberRun<unknown>[] = await runRepo.findAll({ where: { subscriberId: 'replay-fixed' } });
        assert(succeeded, 'no run was recorded for replay-fixed');
        expect(succeeded.status).toBe(EventSubscriberRunStatus.SUCCEEDED);
        expect(succeeded.attempts).toBe(2);
        expect(succeeded.error == undefined).toBe(true);

        sub.unsubscribe();
    }, 20000);

    it('selects by event, subscriber and type together, and puts each run back once', async () => {
        const first: EventSubscriptionInterface = await subscribeFailing('replay.first', 'replay-first');
        const second: EventSubscriptionInterface = await subscribeFailing('replay.second', 'replay-second');

        await eventService.emit('replay.first', { n: 1 });
        await eventService.emit('replay.first', { n: 2 });
        await eventService.emit('replay.second', { n: 3 });
        const [firstEvent, secondEvent]: Event<unknown>[] = await waitForFailedEvents('replay.first', 2);
        assert(firstEvent && secondEvent, 'the events were not recorded');
        await waitForFailedEvents('replay.second', 1);

        // every filter given narrows the selection
        expect(await eventService.replayFailed({ types: ['replay.second'], subscriberIds: ['replay-first'] })).toBe(0);

        expect(await eventService.replayFailed({ eventIds: [firstEvent.id] })).toBe(1);
        // back already, so not failed any more
        expect(await eventService.replayFailed({ eventIds: [firstEvent.id] })).toBe(0);
        expect((await eventRepo.findById(secondEvent.id)).status).toBe(EventStatus.FAILED);

        expect(await eventService.replayFailed({ types: ['replay.second'] })).toBe(1);
        expect(await eventService.replayFailed({ subscriberIds: ['replay-first'] })).toBe(1);

        const runs: EventSubscriberRun<unknown>[] = await runRepo.findAll({
            where: { subscriberId: { oneOf: ['replay-first', 'replay-second'] } }
        });
        expect(runs).toHaveLength(3);
        expect(runs.every(r => r.status === EventSubscriberRunStatus.PENDING_RETRY)).toBe(true);

        first.unsubscribe();
        second.unsubscribe();
    }, 20000);

    it('leaves a run failed whose subscriber no instance hosts any more', async () => {
        const sub: EventSubscriptionInterface = await subscribeFailing('replay.lapsed', 'replay-lapsed');
        await eventService.emit('replay.lapsed', { n: 1 });
        const [event]: Event<unknown>[] = await waitForFailedEvents('replay.lapsed', 1);
        assert(event, 'the event was not recorded');

        // the last instance hosting it goes away
        sub.unsubscribe();
        await registrationRepo.deleteAll({ subscriberId: 'replay-lapsed' });

        expect(await eventService.replayFailed({ subscriberIds: ['replay-lapsed'] })).toBe(0);
        const [run]: EventSubscriberRun<unknown>[] = await runRepo.findAll({ where: { subscriberId: 'replay-lapsed' } });
        expect(run?.status).toBe(EventSubscriberRunStatus.FAILED);
        expect((await eventRepo.findById(event.id)).status).toBe(EventStatus.FAILED);
    });
});