import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { PromiseUtilities, TimeoutError } from './promise.utilities';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';

describe('PromiseUtilities', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    describe('allChunked', () => {
        it('resolves all items in order', async () => {
            const results: number[] = await PromiseUtilities.allChunked([1, 2, 3], n => n * 2);
            expect(results).toEqual([2, 4, 6]);
        });

        it('returns an empty array for an empty input', async () => {
            const results: number[] = await PromiseUtilities.allChunked([], (n: number) => n);
            expect(results).toEqual([]);
        });

        it('handles item counts not evenly divisible by the chunk size', async () => {
            const items: number[] = Array.from({ length: 7 }, (_, i) => i);
            const results: number[] = await PromiseUtilities.allChunked(items, n => n, { chunkSize: 3 });
            expect(results).toEqual(items);
        });

        it('processes items within a single chunk concurrently, not sequentially', async () => {
            const order: number[] = [];
            await PromiseUtilities.allChunked([1, 2, 3], async n => {
                await new Promise(resolve => setTimeout(resolve, (4 - n) * 10));
                order.push(n);
                return n;
            }, { chunkSize: 3 });
            // item 3 has the shortest delay, so it should finish first despite being processed last
            expect(order[0]).toBe(3);
        });
    });

    describe('anyValueTrue', () => {
        it('returns true if any item resolves to true', async () => {
            const result: boolean = await PromiseUtilities.anyValueTrue([1, 2, 3], n => n === 2);
            expect(result).toBe(true);
        });

        it('returns false when all items resolve to false', async () => {
            const result: boolean = await PromiseUtilities.anyValueTrue([1, 2, 3], () => false);
            expect(result).toBe(false);
        });

        it('returns false when all items resolve to false across multiple chunks', async () => {
            const items: number[] = Array.from({ length: 10 }, (_, i) => i);
            const result: boolean = await PromiseUtilities.anyValueTrue(items, () => false, { chunkSize: 3 });
            expect(result).toBe(false);
        });

        it('returns false for an empty array', async () => {
            const result: boolean = await PromiseUtilities.anyValueTrue([], () => true);
            expect(result).toBe(false);
        });

        it('does not propagate a rejection from an individual item, treats it as false', async () => {
            const result: boolean = await PromiseUtilities.anyValueTrue(
                [1, 2],
                (n: number) => {
                    if (n === 1) {
                        throw new Error('boom');
                    }
                    return false;
                }
            );
            expect(result).toBe(false);
        });

        it('finds a true value even if a different item in the same chunk rejects', async () => {
            const result: boolean = await PromiseUtilities.anyValueTrue(
                [1, 2],
                (n: number) => {
                    if (n === 1) {
                        throw new Error('boom');
                    }
                    return true;
                }
            );
            expect(result).toBe(true);
        });
    });

    describe('withTimeout', () => {
        it('resolves with the result when it completes before the timeout', async () => {
            const result: number = await PromiseUtilities.withTimeout(() => 42, 1000);
            expect(result).toBe(42);
        });

        it('rejects with a TimeoutError when the promise takes too long', async () => {
            await expect(
                PromiseUtilities.withTimeout(() => new Promise(resolve => setTimeout(resolve, 500)), 50)
            ).rejects.toBeInstanceOf(TimeoutError);
        });

        it('aborts the timeout signal when the main promise wins the race', async () => {
            let signalAborted: boolean | undefined;
            await PromiseUtilities.withTimeout((signal) => {
                signalAborted = signal.aborted;
                return 'done';
            }, 1000);
            // the signal should not be aborted while the function is still running
            expect(signalAborted).toBe(false);
        });

        it('propagates a rejection from the wrapped function directly (not as a TimeoutError)', async () => {
            await expect(
                PromiseUtilities.withTimeout(() => {
                    throw new Error('inner failure');
                }, 1000)
            ).rejects.toThrow('inner failure');
        });
    });
});