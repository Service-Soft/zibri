import { describe, expect, it, vi, Mock } from 'vitest';

import { CollectMetricsCronJob } from './collect-metrics.cron-job.ts';
import { MetricsServiceInterface } from './metrics-service.interface.ts';
import { LoggerInterface } from '../logging/logger.interface.ts';

function fakeMetricsService(): MetricsServiceInterface & { collect: Mock<() => Promise<void>> } {
    return {
        measureFinishedRequest: vi.fn(),
        getCounter: vi.fn(),
        getGauge: vi.fn(),
        getHistogram: vi.fn(),
        collect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        getMetricSnapshots: vi.fn(() => [])
    };
}

function fakeLogger(): LoggerInterface {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        critical: vi.fn()
    } as unknown as LoggerInterface;
}

describe('CollectMetricsCronJob', () => {
    it('delegates onTick to the metrics service\'s collect', async () => {
        const service: MetricsServiceInterface & { collect: Mock<() => Promise<void>> } = fakeMetricsService();
        const cronJob: CollectMetricsCronJob = new CollectMetricsCronJob(service);
        (cronJob as unknown as { logger: LoggerInterface }).logger = fakeLogger();

        await cronJob.onTick();

        expect(service.collect).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from the metrics service\'s collect', async () => {
        const service: MetricsServiceInterface & { collect: Mock<() => Promise<void>> } = fakeMetricsService();
        service.collect.mockRejectedValue(new Error('collect failed'));
        const cronJob: CollectMetricsCronJob = new CollectMetricsCronJob(service);
        (cronJob as unknown as { logger: LoggerInterface }).logger = fakeLogger();

        await expect(cronJob.onTick()).rejects.toThrow('collect failed');
    });

    it('is configured to run every 5 seconds and not on init', () => {
        const cronJob: CollectMetricsCronJob = new CollectMetricsCronJob(fakeMetricsService());

        expect(cronJob.initialConfig.name).toBe('Collect Metrics');
        expect(cronJob.initialConfig.runOnInit).toBe(false);
    });
});