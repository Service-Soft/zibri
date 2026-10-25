import { setTimeout } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { type EventServiceInterface } from './event-service.interface';
import { EventSubscriberRun, EventSubscriberRunStatus } from './event-subscriber-run.model';
import { Event } from './event.model';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { TestTimeouts } from '../__testing__/constants';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../__testing__/wait-until.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { Ms } from '../utilities/ms';

declare module './event-service.interface' {
    /**
     * What this suite emits.
     */
    interface ZibriEventMap {
        'backlog.failing': Record<string, number>,
        'backlog.blocking': Record<string, number>,
        'backlog.recorded': Record<string, number>
    }
}

// in memory, so that the poll can be driven by hand without a container
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

describe('EventService - events waiting for a retry', () => {
    let server: StartedTestServer;
    let eventService: EventServiceInterface;
    let eventRepo: Repository<Event<unknown>>;
    let runRepo: Repository<EventSubscriberRun<unknown>>;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                // one hook at a time, so the page the poll reads is one event
                defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_MAX_CONCURRENT_HOOKS, useValue: 1 }),
                // a retry far away, so an event waiting for one waits for the whole suite
                defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_RETRY_DELAY_IN_MS, useFactory: () => Ms.HOUR }),
                defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_EXECUTION_LEASE_IN_MS, useValue: 300 })
            ]
        });
        eventService = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);
        eventRepo = inject(repositoryTokenFor(Event));
        runRepo = inject(repositoryTokenFor(EventSubscriberRun));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('reaches an event behind one whose subscriber waits for a retry, and defers that one until its retry is due', async () => {
        await eventService.subscribe('backlog.failing', () => {
            throw new Error('the upstream is down');
        }, { subscriberId: 'backlog-failing', attempts: 2 });
        let release: () => void = () => undefined;
        await eventService.subscribe('backlog.blocking', async () => {
            await new Promise<void>(resolve => {
                release = resolve;
            });
        }, { subscriberId: 'backlog-blocking', timeout: Ms.MINUTE });
        let recorded: number = 0;
        await eventService.subscribe('backlog.recorded', () => {
            recorded++;
        }, { subscriberId: 'backlog-recorded' });

        // the oldest event fails in process and waits an hour for its retry
        await eventService.emit('backlog.failing', { n: 1 });
        await waitUntil(async () => (await runRepo.findAll({ where: { subscriberId: 'backlog-failing' } }))[0]?.status
            === EventSubscriberRunStatus.PENDING_RETRY);
        const [failing] = await eventRepo.findAll({ where: { type: 'backlog.failing' } });
        expect(failing?.nextDispatchAt.getTime()).toBeGreaterThan(Date.now() + (Ms.MINUTE * 50));

        // the one hook slot is taken, so the next emit is not run in process and is left to the poll
        await eventService.emit('backlog.blocking', { n: 2 });
        await eventService.emit('backlog.recorded', { n: 3 });
        expect(recorded).toBe(0);
        release();
        await waitUntil(async () => (await runRepo.findAll({ where: { subscriberId: 'backlog-blocking' } }))[0]?.status
            === EventSubscriberRunStatus.SUCCEEDED);

        // the poll's page holds one event: without the deferral, the failing one every time
        for (let tick: number = 0; tick < 3; tick++) {
            await eventService.dispatchPending();
            await setTimeout(100);
        }

        await waitUntil(() => recorded === 1);
        expect(recorded).toBe(1);
    }, 20000);
});