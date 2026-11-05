import { describe, expect, it, jest } from '@jest/globals';

import { CollectMetricsCronJob } from './collect-metrics.cron-job';
import { MetricsServiceInterface } from './metrics-service.interface';
import { LoggerInterface } from '../logging/logger.interface';

function fakeMetricsService(): MetricsServiceInterface & { collect: jest.Mock<() => Promise<void>> } {
    return {
        measureFinishedRequest: jest.fn(),
        getCounter: jest.fn(),
        getGauge: jest.fn(),
        getHistogram: jest.fn(),
        collect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        getMetricSnapshots: jest.fn(() => [])
    } as unknown as MetricsServiceInterface & { collect: jest.Mock<() => Promise<void>> };
}

function fakeLogger(): LoggerInterface {
    return {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        critical: jest.fn()
    } as unknown as LoggerInterface;
}

describe('CollectMetricsCronJob', () => {
    it('delegates onTick to the metrics service\'s collect', async () => {
        const service: MetricsServiceInterface & { collect: jest.Mock<() => Promise<void>> } = fakeMetricsService();
        const cronJob: CollectMetricsCronJob = new CollectMetricsCronJob(service);
        (cronJob as unknown as { logger: LoggerInterface }).logger = fakeLogger();

        await cronJob.onTick();

        expect(service.collect).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from the metrics service\'s collect', async () => {
        const service: MetricsServiceInterface & { collect: jest.Mock<() => Promise<void>> } = fakeMetricsService();
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