import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { type MetricsServiceInterface } from './metrics-service.interface';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { Ms } from '../utilities/ms';

const INTERVAL_IN_MS: number = Ms.MINUTE * 5;

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.METRICS_DATA_SOURCE_COLLECTOR_INTERVAL_IN_MS, useValue: INTERVAL_IN_MS })
        ]
    });
}, TestTimeouts.inMemory.start);

afterEach(() => {
    jest.restoreAllMocks();
});

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

// 12 §O3: what every instance's metrics cost the shared data source was fixed at a count every 30 seconds
describe('a collector reading the data source', () => {
    it('runs at most once in the interval it is given', async () => {
        const metricsService: MetricsServiceInterface = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);
        let runs: number = 0;
        metricsService.addCollector({
            name: 'open tasks',
            minIntervalInMs: 'dataSource',
            collect: () => {
                runs++;
                return Promise.resolve();
            }
        });
        await metricsService.collect();
        const start: number = Date.now();

        jest.spyOn(Date, 'now').mockReturnValue(start + Ms.MINUTE);
        await metricsService.collect();
        expect(runs).toBe(1);

        jest.spyOn(Date, 'now').mockReturnValue(start + INTERVAL_IN_MS);
        await metricsService.collect();
        expect(runs).toBe(2);
    });
});
