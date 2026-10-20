import { describe, expect, it, vi, Mock } from 'vitest';

import { EventCleanupCronJob } from './event-cleanup.cron-job.ts';
import { Event, EventStatus } from './event.model.ts';
import { Repository } from '../data-source/repository/repository.ts';
import { LoggerInterface } from '../logging/logger.interface.ts';

function fakeEventRepository(): Repository<Event<unknown>> & { deleteAll: Mock<(options: unknown) => Promise<number>> } {
    return {
        deleteAll: vi.fn<(options: unknown) => Promise<number>>().mockResolvedValue(0)
    } as unknown as Repository<Event<unknown>> & { deleteAll: Mock<(options: unknown) => Promise<number>> };
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

describe('EventCleanupCronJob', () => {
    it('deletes finished events whose cleanupAt has passed', async () => {
        const repo: Repository<Event<unknown>> & { deleteAll: Mock<(options: unknown) => Promise<number>> } = fakeEventRepository();
        const cronJob: EventCleanupCronJob = new EventCleanupCronJob(repo, 'forever');
        (cronJob as unknown as { logger: LoggerInterface }).logger = fakeLogger();

        const before: Date = new Date();
        await cronJob.onTick();
        const after: Date = new Date();

        expect(repo.deleteAll).toHaveBeenCalledTimes(1);
        const where: { status: EventStatus, cleanupAt: { before: Date } }
            = repo.deleteAll.mock.calls[0]?.[0] as { status: EventStatus, cleanupAt: { before: Date } };
        expect(where.status).toBe(EventStatus.FINISHED);
        expect(where.cleanupAt.before.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(where.cleanupAt.before.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('logs how many events were removed', async () => {
        const repo: Repository<Event<unknown>> & { deleteAll: Mock<(options: unknown) => Promise<number>> } = fakeEventRepository();
        repo.deleteAll.mockResolvedValue(2);
        const cronJob: EventCleanupCronJob = new EventCleanupCronJob(repo, 'forever');
        const logger: LoggerInterface = fakeLogger();
        (cronJob as unknown as { logger: LoggerInterface }).logger = logger;

        await cronJob.onTick();

        expect(logger.info).toHaveBeenCalledWith('removed 2 events');
    });

    it('silently swallows errors from the repository instead of throwing', async () => {
        const repo: Repository<Event<unknown>> & { deleteAll: Mock<(options: unknown) => Promise<number>> } = fakeEventRepository();
        repo.deleteAll.mockRejectedValue(new Error('db is down'));
        const cronJob: EventCleanupCronJob = new EventCleanupCronJob(repo, 'forever');
        (cronJob as unknown as { logger: LoggerInterface }).logger = fakeLogger();

        await expect(cronJob.onTick()).resolves.toBeUndefined();
    });

    it('is configured to run daily and not on init', () => {
        const cronJob: EventCleanupCronJob = new EventCleanupCronJob(fakeEventRepository(), 'forever');

        expect(cronJob.initialConfig.name).toBe('Event Cleanup');
        expect(cronJob.initialConfig.runOnInit).toBe(false);
    });
});