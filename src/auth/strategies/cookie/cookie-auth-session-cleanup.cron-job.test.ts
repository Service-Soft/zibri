import { describe, expect, it, jest } from '@jest/globals';

import { CookieAuthRefreshSession } from './cookie-auth-refresh-session.model';
import { CookieAuthSessionCleanupCronJob } from './cookie-auth-session-cleanup.cron-job';
import { CookieAuthSession } from './cookie-auth-session.model';
import { Repository } from '../../../data-source/repository';
import { BaseEntity } from '../../../entity/base-entity.model';

type FakeRepository<T extends BaseEntity> = Repository<T> & { deleteAll: jest.Mock<Repository<T>['deleteAll']> };

function fakeRepository<T extends BaseEntity>(): FakeRepository<T> {
    return {
        deleteAll: jest.fn<Repository<T>['deleteAll']>().mockResolvedValue([])
    } as unknown as FakeRepository<T>;
}

describe('CookieAuthSessionCleanupCronJob', () => {
    it('deletes expired sessions and expired refresh sessions', async () => {
        const sessionRepository: FakeRepository<CookieAuthSession> = fakeRepository();
        const refreshSessionRepository: FakeRepository<CookieAuthRefreshSession> = fakeRepository();
        const cronJob: CookieAuthSessionCleanupCronJob = new CookieAuthSessionCleanupCronJob(sessionRepository, refreshSessionRepository);

        const before: Date = new Date();
        await cronJob.onTick();
        const after: Date = new Date();

        expect(sessionRepository.deleteAll).toHaveBeenCalledTimes(1);
        expect(refreshSessionRepository.deleteAll).toHaveBeenCalledTimes(1);

        const sessionWhere: { expirationDate: { before: Date } }
            = sessionRepository.deleteAll.mock.calls[0][0] as unknown as { expirationDate: { before: Date } };
        expect(sessionWhere.expirationDate.before.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(sessionWhere.expirationDate.before.getTime()).toBeLessThanOrEqual(after.getTime());

        const refreshWhere: { expirationDate: { before: Date } }
            = refreshSessionRepository.deleteAll.mock.calls[0][0] as unknown as { expirationDate: { before: Date } };
        expect(refreshWhere.expirationDate.before.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(refreshWhere.expirationDate.before.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('does not filter refresh sessions by blacklisted status, so an unexpired blacklisted session survives cleanup', async () => {
        const sessionRepository: FakeRepository<CookieAuthSession> = fakeRepository();
        const refreshSessionRepository: FakeRepository<CookieAuthRefreshSession> = fakeRepository();
        const cronJob: CookieAuthSessionCleanupCronJob = new CookieAuthSessionCleanupCronJob(sessionRepository, refreshSessionRepository);

        await cronJob.onTick();

        const refreshWhere: Record<string, unknown> = refreshSessionRepository.deleteAll.mock.calls[0][0] as unknown as Record<string, unknown>;
        expect(refreshWhere).not.toHaveProperty('blacklisted');
    });

    it('is configured to run daily and not on init', () => {
        const cronJob: CookieAuthSessionCleanupCronJob = new CookieAuthSessionCleanupCronJob(
            fakeRepository(),
            fakeRepository()
        );

        expect(cronJob.initialConfig.name).toBe('Cleanup cookie auth sessions');
        expect(cronJob.initialConfig.runOnInit).toBe(false);
    });
});