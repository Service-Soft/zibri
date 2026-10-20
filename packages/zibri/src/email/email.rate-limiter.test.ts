import { beforeAll, describe, expect, it, vi } from 'vitest';

import { EmailRateLimiter } from './email.rate-limiter.ts';
import { EmailConfigInput } from './models/email-config.model.ts';
import { initDiContainer } from '../di/init-di-container.function.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { GlobalRegistry } from '../global/global-registry.ts';
import { RateLimitResult } from '../rate-limiting/rate-limit-result.model.ts';
import { Ms } from '../utilities/ms.ts';

function makeConfig(maxEmailsPerHour: number): EmailConfigInput {
    return {
        maxEmailsPerHour,
        defaultSender: 'test@example.com',
        failedRetentionInMs: 'forever'
    };
}

describe('EmailRateLimiter', () => {
    beforeAll(() => {
        initDiContainer();
        GlobalRegistry.markAppAsCreated();
    });

    it('throws when no email config was provided', () => {
        expect(() => new EmailRateLimiter(undefined)).toThrow(InternalError);
        expect(() => new EmailRateLimiter(undefined))
            .toThrow('no email config was provided for the token "ZIBRI_DI_TOKENS.EMAIL_CONFIG"');
    });

    it('uses maxEmailsPerHour from the config as the bucket capacity', async () => {
        const limiter: EmailRateLimiter = new EmailRateLimiter(makeConfig(2));

        expect((await limiter.consume('key', 1)).allowed).toBe(true);
        expect((await limiter.consume('key', 1)).allowed).toBe(true);
        expect((await limiter.consume('key', 1)).allowed).toBe(false);
    });

    it('resets on an hourly interval', async () => {
        vi.useFakeTimers();
        const now: number = Date.now();
        vi.setSystemTime(now);
        try {
            const limiter: EmailRateLimiter = new EmailRateLimiter(makeConfig(1));
            const result: RateLimitResult = await limiter.consume('key', 1);
            expect(result.resetsAtMs).toBe(now + Ms.HOUR);
        }
        finally {
            vi.useRealTimers();
        }
    });
});