import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { MetricsSnapshot } from './metrics-snapshot.model';
import { PrometheusMetricsService } from './metrics.service';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Auth } from '../auth/decorators/auth.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';

@Controller('/buckets-test')
class BucketsTestController {
    @Auth.skip()
    @Get('/')
    read(): { ok: true } {
        return { ok: true };
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string = '';

beforeAll(async () => {
    server = await startTestServer({
        controllers: [BucketsTestController],
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.METRICS_REQUEST_DURATION_BUCKETS_IN_MS, useValue: [1, 5, 25] })
        ]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('the request duration histogram', () => {
    it('counts requests into the configured buckets, given in milliseconds and named in seconds', async () => {
        await (await fetch(`${baseUrl}/buckets-test`)).text();
        const service: PrometheusMetricsService = inject(PrometheusMetricsService);

        await service.collect();

        const snapshot: MetricsSnapshot | undefined = service.getMetricSnapshots().at(-1);
        const bounds: (string | number | undefined)[] = (snapshot?.metrics ?? [])
            .filter(m => m.name === 'http_request_duration_seconds_bucket' && m.labels['route'] === '/buckets-test/')
            .map(m => m.labels['le']);
        expect(bounds).toEqual([0.001, 0.005, 0.025, '+Inf']);
    }, 15_000);
});