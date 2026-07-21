import { describe, expect, it, jest } from '@jest/globals';

import { LogCleanupCronJob } from './log-cleanup.cron-job';
import { Log } from './log.model';
import { LoggerInterface } from './logger.interface';
import { Repository } from '../data-source/repository';

function fakeLogRepository(): Repository<Log> & { deleteAll: jest.Mock<() => Promise<void>> } {
    return {
        deleteAll: jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
    } as unknown as Repository<Log> & { deleteAll: jest.Mock<() => Promise<void>> };
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

describe('LogCleanupCronJob', () => {
    it('deletes all logs whose cleanupAt has passed', async () => {
        const repo: Repository<Log> & { deleteAll: jest.Mock<() => Promise<void>> } = fakeLogRepository();
        const cronJob: LogCleanupCronJob = new LogCleanupCronJob(repo);
        (cronJob as unknown as { logger: LoggerInterface }).logger = fakeLogger();

        const before: Date = new Date();
        await cronJob.onTick();
        const after: Date = new Date();

        expect(repo.deleteAll).toHaveBeenCalledTimes(1);
        const where: { cleanupAt: { before: Date } } = repo.deleteAll.mock.calls[0][0] as unknown as { cleanupAt: { before: Date } };
        expect(where.cleanupAt.before.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(where.cleanupAt.before.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('logs an info message on each tick', async () => {
        const repo: Repository<Log> & { deleteAll: jest.Mock<() => Promise<void>> } = fakeLogRepository();
        const cronJob: LogCleanupCronJob = new LogCleanupCronJob(repo);
        const logger: LoggerInterface = fakeLogger();
        (cronJob as unknown as { logger: LoggerInterface }).logger = logger;

        await cronJob.onTick();

        expect(logger.info).toHaveBeenCalledWith('cleans up expired logs');
    });

    it('is configured to run daily and not on init', () => {
        const cronJob: LogCleanupCronJob = new LogCleanupCronJob(fakeLogRepository());

        expect(cronJob.initialConfig.name).toBe('Log Cleanup');
        expect(cronJob.initialConfig.runOnInit).toBe(false);
    });
});