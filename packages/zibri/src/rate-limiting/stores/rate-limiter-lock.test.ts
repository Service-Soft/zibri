import { describe, expect, it } from 'vitest';

import { InProcessRateLimiterLock } from './rate-limiter-lock.interface.ts';

describe('InProcessRateLimiterLock', () => {

    it('serializes operations of the same key', async () => {
        const lock: InProcessRateLimiterLock = new InProcessRateLimiterLock();
        let running: number = 0;
        let maxRunning: number = 0;

        await Promise.all(Array.from({ length: 10 }, () => lock.withLock('key', async () => {
            running++;
            maxRunning = Math.max(maxRunning, running);
            await new Promise(resolve => setTimeout(resolve, 1));
            running--;
        })));

        expect(maxRunning).toBe(1);
    });

    it('does not lose an update of a read modify write cycle', async () => {
        const lock: InProcessRateLimiterLock = new InProcessRateLimiterLock();
        let state: number = 0;

        await Promise.all(Array.from({ length: 10 }, () => lock.withLock('key', async () => {
            const current: number = state;
            // without the lock every operation would read the same value here
            await new Promise(resolve => setTimeout(resolve, 1));
            state = current + 1;
        })));

        expect(state).toBe(10);
    });

    it('does not block other keys', async () => {
        const lock: InProcessRateLimiterLock = new InProcessRateLimiterLock();
        const order: string[] = [];

        await Promise.all([
            lock.withLock('slow', async () => {
                await new Promise(resolve => setTimeout(resolve, 20));
                order.push('slow');
            }),
            // eslint-disable-next-line typescript/require-await
            lock.withLock('fast', async () => {
                order.push('fast');
            })
        ]);

        expect(order).toEqual(['fast', 'slow']);
    });

    it('releases the lock when the operation throws', async () => {
        const lock: InProcessRateLimiterLock = new InProcessRateLimiterLock();

        await expect(lock.withLock('key', () => Promise.reject(new Error('nope')))).rejects.toThrow('nope');
        await expect(lock.withLock('key', () => Promise.resolve('works'))).resolves.toBe('works');
    });
});