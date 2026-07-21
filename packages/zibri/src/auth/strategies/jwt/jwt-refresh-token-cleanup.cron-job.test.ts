import { describe, expect, it, jest } from '@jest/globals';

import { JwtRefreshTokenCleanupCronJob } from './jwt-refresh-token-cleanup.cron-job';
import { JwtRefreshToken } from './jwt-refresh-token.model';
import { Repository } from '../../../data-source/repository';

function fakeRefreshTokenRepository(): Repository<JwtRefreshToken> & { deleteAll: jest.Mock<Repository<JwtRefreshToken>['deleteAll']> } {
    return {
        deleteAll: jest.fn<Repository<JwtRefreshToken>['deleteAll']>().mockResolvedValue([])
    } as unknown as Repository<JwtRefreshToken> & { deleteAll: jest.Mock<Repository<JwtRefreshToken>['deleteAll']> };
}

describe('JwtRefreshTokenCleanupCronJob', () => {
    it('deletes refresh tokens whose expirationDate has passed', async () => {
        const repo: Repository<JwtRefreshToken> & { deleteAll: jest.Mock<Repository<JwtRefreshToken>['deleteAll']> } = fakeRefreshTokenRepository();
        const cronJob: JwtRefreshTokenCleanupCronJob = new JwtRefreshTokenCleanupCronJob(repo);

        const before: Date = new Date();
        await cronJob.onTick();
        const after: Date = new Date();

        expect(repo.deleteAll).toHaveBeenCalledTimes(1);
        const where: { expirationDate: { before: Date } } = repo.deleteAll.mock.calls[0][0] as unknown as { expirationDate: { before: Date } };
        expect(where.expirationDate.before.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(where.expirationDate.before.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('does not filter by blacklisted status, so an unexpired blacklisted token survives cleanup', async () => {
        const repo: Repository<JwtRefreshToken> & { deleteAll: jest.Mock<Repository<JwtRefreshToken>['deleteAll']> } = fakeRefreshTokenRepository();
        const cronJob: JwtRefreshTokenCleanupCronJob = new JwtRefreshTokenCleanupCronJob(repo);

        await cronJob.onTick();

        const where: Record<string, unknown> = repo.deleteAll.mock.calls[0][0] as unknown as Record<string, unknown>;
        expect(where).not.toHaveProperty('blacklisted');
    });

    it('is configured to run daily and not on init', () => {
        const cronJob: JwtRefreshTokenCleanupCronJob = new JwtRefreshTokenCleanupCronJob(fakeRefreshTokenRepository());

        expect(cronJob.initialConfig.name).toBe('Cleanup jwt refresh tokens');
        expect(cronJob.initialConfig.runOnInit).toBe(false);
    });
});