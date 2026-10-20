import { describe, expect, it, vi, Mock } from 'vitest';

import { LogCleanupCronJob } from './log-cleanup.cron-job.ts';
import { Log } from './log.model.ts';
import { LoggerInterface } from './logger.interface.ts';
import { Repository } from '../data-source/repository/repository.ts';

function fakeLogRepository(): Repository<Log> & { deleteAll: Mock<(options: unknown) => Promise<void>> } {
    return {
        deleteAll: vi.fn<(options: unknown) => Promise<void>>().mockResolvedValue(undefined)
    } as unknown as Repository<Log> & { deleteAll: Mock<(options: unknown) => Promise<void>> };
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

describe('LogCleanupCronJob', () => {
    it('deletes all logs whose cleanupAt has passed', async () => {
        const repo: Repository<Log> & { deleteAll: Mock<(options: unknown) => Promise<void>> } = fakeLogRepository();
        const cronJob: LogCleanupCronJob = new LogCleanupCronJob(repo);
        (cronJob as unknown as { logger: LoggerInterface }).logger = fakeLogger();

        const before: Date = new Date();
        await cronJob.onTick();
        const after: Date = new Date();

        expect(repo.deleteAll).toHaveBeenCalledTimes(1);
        const where: { cleanupAt: { before: Date } } = repo.deleteAll.mock.calls[0]?.[0] as { cleanupAt: { before: Date } };
        expect(where.cleanupAt.before.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(where.cleanupAt.before.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('logs an info message on each tick', async () => {
        const repo: Repository<Log> & { deleteAll: Mock<(options: unknown) => Promise<void>> } = fakeLogRepository();
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