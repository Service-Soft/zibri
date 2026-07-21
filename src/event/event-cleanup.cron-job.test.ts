import { describe, expect, it, jest } from '@jest/globals';

import { EventCleanupCronJob } from './event-cleanup.cron-job';
import { Event, EventStatus } from './event.model';
import { Repository } from '../data-source/repository';
import { LoggerInterface } from '../logging/logger.interface';

function fakeEventRepository(): Repository<Event<unknown>> & { deleteAll: jest.Mock<() => Promise<Event<unknown>[]>> } {
    return {
        deleteAll: jest.fn<() => Promise<Event<unknown>[]>>().mockResolvedValue([])
    } as unknown as Repository<Event<unknown>> & { deleteAll: jest.Mock<() => Promise<Event<unknown>[]>> };
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

describe('EventCleanupCronJob', () => {
    it('deletes finished events whose cleanupAt has passed', async () => {
        const repo: Repository<Event<unknown>> & { deleteAll: jest.Mock<() => Promise<Event<unknown>[]>> } = fakeEventRepository();
        const cronJob: EventCleanupCronJob = new EventCleanupCronJob(repo);
        (cronJob as unknown as { logger: LoggerInterface }).logger = fakeLogger();

        const before: Date = new Date();
        await cronJob.onTick();
        const after: Date = new Date();

        expect(repo.deleteAll).toHaveBeenCalledTimes(1);
        const where: { status: EventStatus, cleanupAt: { before: Date } }
            = repo.deleteAll.mock.calls[0][0] as unknown as { status: EventStatus, cleanupAt: { before: Date } };
        expect(where.status).toBe(EventStatus.FINISHED);
        expect(where.cleanupAt.before.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(where.cleanupAt.before.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('logs how many events were removed', async () => {
        const repo: Repository<Event<unknown>> & { deleteAll: jest.Mock<() => Promise<Event<unknown>[]>> } = fakeEventRepository();
        repo.deleteAll.mockResolvedValue([{}, {}] as unknown as Event<unknown>[]);
        const cronJob: EventCleanupCronJob = new EventCleanupCronJob(repo);
        const logger: LoggerInterface = fakeLogger();
        (cronJob as unknown as { logger: LoggerInterface }).logger = logger;

        await cronJob.onTick();

        expect(logger.info).toHaveBeenCalledWith('removed 2 events');
    });

    it('silently swallows errors from the repository instead of throwing', async () => {
        const repo: Repository<Event<unknown>> & { deleteAll: jest.Mock<() => Promise<Event<unknown>[]>> } = fakeEventRepository();
        repo.deleteAll.mockRejectedValue(new Error('db is down'));
        const cronJob: EventCleanupCronJob = new EventCleanupCronJob(repo);
        (cronJob as unknown as { logger: LoggerInterface }).logger = fakeLogger();

        await expect(cronJob.onTick()).resolves.toBeUndefined();
    });

    it('is configured to run daily and not on init', () => {
        const cronJob: EventCleanupCronJob = new EventCleanupCronJob(fakeEventRepository());

        expect(cronJob.initialConfig.name).toBe('Event Cleanup');
        expect(cronJob.initialConfig.runOnInit).toBe(false);
    });
});