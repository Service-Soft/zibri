import { setTimeout } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { type EventServiceInterface } from './event-service.interface';
import { EventSubscriberRegistration } from './event-subscriber-registration.model';
import { EventSubscriberRun, EventSubscriberRunStatus } from './event-subscriber-run.model';
import { Event, EventStatus } from './event.model';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../__testing__/wait-until.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { QueuedWorkRun } from '../queue/queued-work-run.model';

declare module './event-service.interface' {
    /**
     * What this suite emits.
     */
    interface ZibriEventMap {
        'delivery.retried': { n: number },
        'delivery.transactional': { label: string },
        'delivery.at-most-once': { n: number },
        'delivery.everywhere': { n: number }
    }
}

/**
 * What a hook writes, to see whether it was kept.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class DeliveryEffect extends BaseEntity {
    @Property.string()
    label!: string;
}

/**
 * How long a claim lasts here: a retry waits for the claim of the attempt before it to lapse.
 */
const leaseInMs: number = 200;

let server: StartedTestServer | undefined;
let eventService: EventServiceInterface;
let events: Repository<Event<unknown>>;
let runs: Repository<EventSubscriberRun<unknown>>;
let effects: Repository<DeliveryEffect>;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, DeliveryEffect],
                repositories: defaultTestServerRepositories
            })
        ],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_RETRY_DELAY_IN_MS, useFactory: () => 1 }),
            defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_EXECUTION_LEASE_IN_MS, useValue: leaseInMs })
        ]
    });
    eventService = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);
    events = inject(repositoryTokenFor(Event));
    runs = inject(repositoryTokenFor(EventSubscriberRun));
    effects = inject(repositoryTokenFor(DeliveryEffect));
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

/**
 * Waits for the run a subscriber recorded of an event to reach a status.
 * @param subscriberId - The subscriber.
 * @param status - The status.
 * @returns The run.
 */
async function waitForRun(subscriberId: string, status: EventSubscriberRunStatus): Promise<EventSubscriberRun<unknown>> {
    await waitUntil(async () => (await runs.findOne({ where: { subscriberId }, required: false }))?.status === status);
    return await runs.findOne({ where: { subscriberId } });
}

/**
 * Offers the events whose retry is due, once the claim of the attempt before has lapsed.
 */
async function dispatchRetries(): Promise<void> {
    await setTimeout(leaseInMs * 2);
    await eventService.dispatchPending();
}

// 09 §Q5: a hook ran at least once with nothing to tell its attempts apart, and nothing else
describe('EventService - how a subscriber is delivered an event', () => {
    it('hands the hook a run id that stays the same on every attempt', async () => {
        const handed: QueuedWorkRun[] = [];
        await eventService.subscribe('delivery.retried', (_, __, run) => {
            handed.push(run);
            if (handed.length === 1) {
                throw new Error('the payment provider timed out');
            }
        }, { subscriberId: 'delivery-retried', attempts: 2 });

        await eventService.emit('delivery.retried', { n: 1 });
        await waitForRun('delivery-retried', EventSubscriberRunStatus.PENDING_RETRY);
        await dispatchRetries();
        await waitForRun('delivery-retried', EventSubscriberRunStatus.SUCCEEDED);

        const [event] = await events.findAll({ where: { type: 'delivery.retried' } });
        expect(handed.map(run => [run.runId, run.attempt])).toEqual([[`${event?.id}:delivery-retried`, 1], [`${event?.id}:delivery-retried`, 2]]);
    });

    it('keeps what a transactional hook wrote together with recording its run', async () => {
        await eventService.subscribe('delivery.transactional', async (event, _, run) => {
            await effects.create({ label: event.data.label }, { transaction: run.transaction });
            if (event.data.label === 'failing') {
                throw new Error('the invoice could not be numbered');
            }
        }, { subscriberId: 'delivery-transactional', attempts: 2, delivery: 'transactional' });

        await eventService.emit('delivery.transactional', { label: 'kept' });
        await waitForRun('delivery-transactional', EventSubscriberRunStatus.SUCCEEDED);
        expect(await effects.findAll({ where: { label: 'kept' } })).toHaveLength(1);

        await runs.deleteAll({ subscriberId: 'delivery-transactional' });
        await eventService.emit('delivery.transactional', { label: 'failing' });
        const failed: EventSubscriberRun<unknown> = await waitForRun('delivery-transactional', EventSubscriberRunStatus.PENDING_RETRY);
        expect(failed.attempts).toBe(1);
        expect(await effects.findAll({ where: { label: 'failing' } })).toEqual([]);
    });

    it('records a run delivered at most once as failed before its hook runs, and never runs it again', async () => {
        const whileRunning: EventSubscriberRun<unknown>[] = [];
        await eventService.subscribe('delivery.at-most-once', async event => {
            whileRunning.push(await runs.findOne({ where: { subscriberId: 'delivery-at-most-once' } }));
            if (event.data.n === 2) {
                throw new Error('the push service refused it');
            }
        }, { subscriberId: 'delivery-at-most-once', attempts: 3, delivery: 'atMostOnce' });

        await eventService.emit('delivery.at-most-once', { n: 1 });
        await waitForRun('delivery-at-most-once', EventSubscriberRunStatus.SUCCEEDED);
        expect(whileRunning[0]).toMatchObject({ status: EventSubscriberRunStatus.FAILED, attempts: 1 });
        expect(whileRunning[0]?.error?.paragraphs.join('\n')).toContain('stopped before it finished');

        await runs.deleteAll({ subscriberId: 'delivery-at-most-once' });
        await eventService.emit('delivery.at-most-once', { n: 2 });
        const failed: EventSubscriberRun<unknown> = await waitForRun('delivery-at-most-once', EventSubscriberRunStatus.FAILED);
        await dispatchRetries();
        expect(failed.attempts).toBe(1);
        expect(whileRunning).toHaveLength(2);
    });

    it('runs a subscriber on every instance without a run or a hold on the event', async () => {
        const received: number[] = [];
        await eventService.subscribe('delivery.everywhere', event => {
            received.push(event.data.n);
        }, { subscriberId: 'delivery-everywhere', runsOn: 'everyInstance' });

        await eventService.emit('delivery.everywhere', { n: 7 });
        await waitUntil(() => received.length === 1);
        await eventService.dispatchPending();

        expect(received).toEqual([7]);
        expect(await runs.findAll({ where: { subscriberId: 'delivery-everywhere' } })).toEqual([]);
        const [event] = await events.findAll({ where: { type: 'delivery.everywhere' } });
        expect(event?.status).toBe(EventStatus.FINISHED);
        // registered, so an instance emitting the event knows to tell the others
        expect((await inject<Repository<EventSubscriberRegistration>>(repositoryTokenFor(EventSubscriberRegistration))
            .findAll({ where: { subscriberId: 'delivery-everywhere' } })).map(r => r.runsOn)).toEqual(['everyInstance']);
        expect(event?.subscriberIds).toEqual([]);
    });
});