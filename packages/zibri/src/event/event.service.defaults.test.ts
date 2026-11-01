import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { type EventServiceInterface } from './event-service.interface';
import { Event } from './event.model';
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
import { Ms } from '../utilities/ms';

// evaluation/round-2/12-hardcoded-values.md §D1: a finished event was kept a day and a hook given 30
// seconds unless each emit and each subscriber said otherwise, so the framework's own events could not

declare module './event-service.interface' {
    /**
     * What this suite emits.
     */
    interface ZibriEventMap {
        'defaults.kept': Record<string, number>,
        'defaults.slow': Record<string, number>
    }
}

/**
 * How long this application keeps a finished event.
 */
const FINISHED_RETENTION_IN_MS: number = Ms.HOUR * 2;

/**
 * How long this application gives a hook.
 */
const HOOK_TIMEOUT_IN_MS: number = 200;

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

describe('EventService, with the defaults an application sets', () => {
    let server: StartedTestServer;
    let eventService: EventServiceInterface;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_FINISHED_RETENTION_IN_MS, useValue: FINISHED_RETENTION_IN_MS }),
                defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_HOOK_TIMEOUT_IN_MS, useValue: HOOK_TIMEOUT_IN_MS })
            ]
        });
        eventService = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('keeps an event that names no time of its own for as long as the application says', async () => {
        const before: number = Date.now();

        await eventService.emit('defaults.kept', { n: 1 });

        const [event] = await inject<Repository<Event<unknown>>>(repositoryTokenFor(Event)).findAll({ where: { type: 'defaults.kept' } });
        const keptForInMs: number = new Date(event?.cleanupAt ?? 0).getTime() - before;
        expect(keptForInMs).toBeGreaterThanOrEqual(FINISHED_RETENTION_IN_MS);
        expect(keptForInMs).toBeLessThan(FINISHED_RETENTION_IN_MS + Ms.MINUTE);
    });

    it('gives a hook whose subscriber names no timeout as long as the application says', async () => {
        const signals: AbortSignal[] = [];
        await eventService.subscribe('defaults.slow', async (_event, signal) => {
            signals.push(signal);
            await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
        }, { subscriberId: 'defaults-slow' });

        await eventService.emit('defaults.slow', { n: 1 });

        await waitUntil(() => signals[0]?.aborted === true, Ms.SECOND * 5);
        expect(signals[0]?.aborted).toBe(true);
    }, 30000);
});
