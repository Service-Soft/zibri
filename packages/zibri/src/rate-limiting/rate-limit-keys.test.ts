import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { RateLimited } from './decorators/rate-limited.decorator';
import { RateLimiter } from './decorators/rate-limiter.decorator';
import { TokenBucketRateLimiter, TokenBucketState } from './limiter/token-bucket.rate-limiter';
import { RateLimitKeys } from './rate-limit-keys';
import { InMemoryRateLimiterStore } from './stores/in-memory.rate-limiter-store';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Ms } from '../utilities/ms';

/**
 * One call, then nothing for an hour.
 *
 * A capacity of one means the second call against the same key always fails, so a test never has to
 * wait for a refill to observe two callers sharing a bucket - or not sharing one.
 */
@RateLimiter()
class OneCallRateLimiter extends TokenBucketRateLimiter {
    constructor() {
        super(Ms.HOUR, {
            name: 'one-call-rate-limiter',
            capacity: 1,
            store: new InMemoryRateLimiterStore<TokenBucketState>(),
            maxReservationWaitMs: undefined
        });
    }
}

/**
 * The same limit, for a route that wants one bucket for everybody.
 */
@RateLimiter()
class OneCallSharedRateLimiter extends TokenBucketRateLimiter {
    constructor() {
        super(Ms.HOUR, {
            name: 'one-call-shared-rate-limiter',
            capacity: 1,
            store: new InMemoryRateLimiterStore<TokenBucketState>(),
            maxReservationWaitMs: undefined
        });
    }
}

@Controller('/rate-limit-keys')
class RateLimitKeysController {
    // async because @RateLimited wraps a promise returning method, which is what the limiter has to
    // await before letting the call through
    @RateLimited(OneCallRateLimiter)
    @Get('/per-caller')
    // eslint-disable-next-line typescript/require-await
    async perCaller(): Promise<{ ok: boolean }> {
        return { ok: true };
    }

    @RateLimited(OneCallSharedRateLimiter, { keyFn: RateLimitKeys.GLOBAL })
    @Get('/shared')
    // eslint-disable-next-line typescript/require-await
    async shared(): Promise<{ ok: boolean }> {
        return { ok: true };
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;

beforeAll(async () => {
    server = await startTestServer({
        controllers: [RateLimitKeysController],
        // the only way two callers are distinguishable from one machine, and the setting the per
        // caller key depends on in every real deployment: without it both addresses below are the
        // same client as far as the application is concerned
        security: { trustProxy: true }
    });
    baseUrl = await server.start();
}, 15000);

afterAll(async () => {
    await server?.shutdown();
}, 15000);

/**
 * Calls one of the limited routes as a given client.
 * @param path - The route to call.
 * @param ip - The address to arrive from.
 * @returns The status it answered with.
 */
async function callAs(path: string, ip: string): Promise<number> {
    const res: Response = await fetch(`${baseUrl}/rate-limit-keys${path}`, { headers: { 'x-forwarded-for': ip } });
    return res.status;
}

describe('rate limit keys', () => {

    it('counts a limit per caller when the route names no key', async () => {
        expect(await callAs('/per-caller', '203.0.113.1')).toBe(200);
        expect(await callAs('/per-caller', '203.0.113.1')).toBe(429);

        // a different caller, whose capacity the first one must not have spent. This is the whole
        // finding: with one shared bucket, whoever gets there first locks out everybody else.
        expect(await callAs('/per-caller', '203.0.113.2')).toBe(200);
    });

    it('counts a limit against one bucket when the route asks for it', async () => {
        expect(await callAs('/shared', '198.51.100.1')).toBe(200);

        // another caller entirely, and still refused: capacity that belongs to the resource rather
        // than the caller is exactly what GLOBAL is for
        expect(await callAs('/shared', '198.51.100.2')).toBe(429);
    });
});