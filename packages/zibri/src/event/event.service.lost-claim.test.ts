import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { type EventServiceInterface } from './event-service.interface';
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
import { LeaseLostError } from '../leases/lease-lost.error';
import { Lease } from '../leases/lease.model';
import { Ms } from '../utilities/ms';

declare module './event-service.interface' {
    /**
     * What this suite emits.
     */
    interface ZibriEventMap {
        'claim.lost': Record<string, number>
    }
}

const LEASE_IN_MS: number = 300;
const SUBSCRIBER_ID: string = 'claim-lost';

// in memory, so that the claim can be taken away as another instance would take it
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

describe('EventService, losing the claim on an event while its hook runs', () => {
    let server: StartedTestServer;
    let eventService: EventServiceInterface;
    let eventRepo: Repository<Event<unknown>>;
    let runRepo: Repository<EventSubscriberRun<unknown>>;
    let leases: Repository<Lease>;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_EXECUTION_LEASE_IN_MS, useValue: LEASE_IN_MS })
            ]
        });
        eventService = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);
        eventRepo = inject(repositoryTokenFor(Event));
        runRepo = inject(repositoryTokenFor(EventSubscriberRun));
        leases = inject(repositoryTokenFor(Lease));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('tells the hook through its signal, records nothing, and runs the hook again once it takes the claim itself', async () => {
        const reasons: unknown[] = [];
        let runs: number = 0;
        await eventService.subscribe('claim.lost', async (_event, signal) => {
            runs++;
            // the first run waits to be told; the one after the takeover is an ordinary run
            if (runs > 1) {
                return;
            }
            await new Promise<void>(resolve => {
                signal.addEventListener('abort', () => {
                    reasons.push(signal.reason);
                    resolve();
                }, { once: true });
            });
        }, { subscriberId: SUBSCRIBER_ID, timeoutInMs: Ms.MINUTE });

        await eventService.emit('claim.lost', { n: 1 });
        const [event] = await eventRepo.findAll({ where: { type: 'claim.lost' } });
        const key: string = `event:${event?.id}:${SUBSCRIBER_ID}`;
        await waitUntil(async () => await leases.count({ where: { key } }) === 1);

        // what another instance does once the claim lapsed: takes it
        await leases.deleteAll({ key });

        await waitUntil(() => reasons.length === 1, Ms.SECOND * 5);
        expect(reasons[0]).toBeInstanceOf(LeaseLostError);

        // nothing written for an attempt that is somebody else's now, and the event is still owed
        await sleep(LEASE_IN_MS);
        expect(await runRepo.count({ where: { subscriberId: SUBSCRIBER_ID } })).toBe(0);
        expect((await eventRepo.findById(event?.id ?? '')).status).toBe(EventStatus.CREATED);

        // the poll finds the event owed and the claim free, which is the takeover from the taker's side
        await eventService.dispatchPending();
        await waitUntil(async () => await runRepo.count({ where: { subscriberId: SUBSCRIBER_ID } }) === 1, Ms.SECOND * 5);
        expect(runs).toBe(2);
        expect((await runRepo.findAll({ where: { subscriberId: SUBSCRIBER_ID } }))[0]?.status).toBe(EventSubscriberRunStatus.SUCCEEDED);
    }, 30000);
});