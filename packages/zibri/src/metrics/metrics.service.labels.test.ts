import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Metric } from './metric.model';
import { MetricsSnapshot } from './metrics-snapshot.model';
import { PrometheusMetricsService } from './metrics.service';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { inject } from '../di/inject.function';

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

// round 2's 06 §F22: the prometheus client hands some values over without their labels, which a
// reader of a snapshot keying on a label then fails on
describe('PrometheusMetricsService - a snapshot', () => {
    it('hands every metric its labels, an empty set for one that has none', async () => {
        const service: PrometheusMetricsService = inject(PrometheusMetricsService);
        service.getCounter('labels_test_unlabelled_total').increase();
        service.getGauge('labels_test_unlabelled').set({}, 1);

        await service.collect();

        const snapshot: MetricsSnapshot | undefined = service.getMetricSnapshots().at(-1);
        const unlabelled: Metric[] = snapshot?.metrics.filter(m => typeof m.labels !== 'object') ?? [];
        expect(unlabelled.map(m => m.name)).toEqual([]);
    });
});