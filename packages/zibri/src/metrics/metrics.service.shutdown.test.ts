import { describe, expect, it } from '@jest/globals';
import type { MetricObjectWithValues, MetricValue, Registry } from '@prometheus-io/client';
import { createInMemoryDataSource, StartedTestServer, startTestServer } from 'zibri-testing';

import { PrometheusMetricsService } from './metrics.service';
import { TestTimeouts } from '../__testing__/constants';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource();

/**
 * How often the event loop's utilization has been observed so far.
 * @param registry - The registry of the metrics service.
 * @returns The count of the utilization histogram.
 */
async function utilizationObservations(registry: Registry): Promise<number> {
    const metric: MetricObjectWithValues<MetricValue<string>> | undefined = await registry.getSingleMetric('nodejs_eventloop_utilization_histogram')?.get();
    const count: MetricValue<string> | undefined = metric?.values.find(v => 'metricName' in v && v.metricName === 'nodejs_eventloop_utilization_histogram_count');
    return count?.value ?? 0;
}

// the client's default metrics start a gc observer, an event loop delay monitor and an interval
// that nothing stopped: every application built in one process added a set, which went on running
// after it shut down. Under jest that is every test file, and each set kept its file's environment
// alive - a few dozen megabytes a file, until the machine ran out of memory
describe('PrometheusMetricsService, once the application shut down', () => {
    it('stops measuring the event loop', async () => {
        const server: StartedTestServer = await startTestServer({ dataSources: [dataSourceClass] });
        const service: PrometheusMetricsService = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE) as PrometheusMetricsService;
        const registry: Registry = service['registry'];
        // the utilization is observed every 100ms
        await new Promise(resolve => setTimeout(resolve, 250));
        expect(await utilizationObservations(registry)).toBeGreaterThan(0);

        await server.shutdown();
        const atShutdown: number = await utilizationObservations(registry);
        await new Promise(resolve => setTimeout(resolve, 350));

        expect(await utilizationObservations(registry)).toBe(atShutdown);
    }, TestTimeouts.inMemory.start);
});