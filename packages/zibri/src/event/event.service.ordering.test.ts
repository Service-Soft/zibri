import { setTimeout } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { type EventServiceInterface } from './event-service.interface';
import { EventSubscriberRun, EventSubscriberRunStatus } from './event-subscriber-run.model';
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

declare module './event-service.interface' {
    /**
     * What this suite emits.
     */
    interface ZibriEventMap {
        'ordering.numbered': { n: number }
    }
}

// in memory, so that the poll can be driven by hand without a container
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

// round 2's 06 §F15: events.md promises no order, and this holds what that means for a retry - the
// events of one type are handled in no order of their emits
describe('EventService - the order hooks run in', () => {
    let server: StartedTestServer;
    let eventService: EventServiceInterface;
    let runRepo: Repository<EventSubscriberRun<unknown>>;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_RETRY_DELAY_IN_MS, useFactory: () => 100 }),
                defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_EXECUTION_LEASE_IN_MS, useValue: 300 })
            ]
        });
        eventService = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);
        runRepo = inject(repositoryTokenFor(EventSubscriberRun));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('hands a hook an event emitted later before an earlier one it is retrying', async () => {
        const handled: number[] = [];
        let failedOnce: boolean = false;
        await eventService.subscribe('ordering.numbered', event => {
            if (event.data.n === 1 && !failedOnce) {
                failedOnce = true;
                throw new Error('the upstream is down');
            }
            handled.push(event.data.n);
        }, { subscriberId: 'ordering-numbered', attempts: 2 });

        await eventService.emit('ordering.numbered', { n: 1 });
        await waitUntil(async () => (await runRepo.findAll({ where: { subscriberId: 'ordering-numbered' } }))
            .some(run => run.status === EventSubscriberRunStatus.PENDING_RETRY));
        await eventService.emit('ordering.numbered', { n: 2 });
        await waitUntil(() => handled.includes(2));

        // the retry, once its delay and the failed attempt's claim have passed
        await waitUntil(async () => {
            await eventService.dispatchPending();
            await setTimeout(100);
            return handled.length === 2;
        }, 10000);

        expect(handled).toEqual([2, 1]);
    }, 20000);
});