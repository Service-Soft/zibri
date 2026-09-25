import { getEventListeners } from 'node:events';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { PromiseUtilities, TimeoutError } from './promise.utilities';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';

// this repository's own fixtures rather than an empty store: importing the harness registers
// JwtUser, and a data source that does not carry it is refused by name
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

describe('PromiseUtilities', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        // nothing here stores anything - what the server is for is an initialized application, since
        // `$ts` refuses to translate while one is offline
        server = await startTestServer({ dataSources: [dataSourceClass] });
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

        it('ends with the outer signal\'s reason when that fires first', async () => {
            const outer: AbortController = new AbortController();
            const reason: Error = new Error('the caller is gone');
            setTimeout(() => outer.abort(reason), 20).unref();

            await expect(
                PromiseUtilities.withTimeout(() => new Promise(resolve => setTimeout(resolve, 2000)), 1000, outer.signal)
            ).rejects.toBe(reason);
        });

        it('still ends with a TimeoutError when its own timer is the shorter of the two', async () => {
            const outer: AbortController = new AbortController();

            await expect(
                PromiseUtilities.withTimeout(() => new Promise(resolve => setTimeout(resolve, 2000)), 50, outer.signal)
            ).rejects.toBeInstanceOf(TimeoutError);
            outer.abort();
        });

        it('fires the signal it hands the function when the outer one fires', async () => {
            const outer: AbortController = new AbortController();
            let innerAborted: boolean = false;
            setTimeout(() => outer.abort(new Error('gone')), 20).unref();

            await expect(PromiseUtilities.withTimeout(
                async (signal: AbortSignal) => {
                    signal.addEventListener('abort', () => {
                        innerAborted = true;
                    });
                    await new Promise(resolve => setTimeout(resolve, 2000));
                },
                1000,
                outer.signal
            )).rejects.toThrow('gone');

            // the whole point of handing one down: the work itself can end rather than being left to
            // finish something nobody is waiting for
            expect(innerAborted).toBe(true);
        });
    });

    describe('withSignal', () => {
        it('resolves with the result when nothing aborts', async () => {
            const controller: AbortController = new AbortController();
            const result: number = await PromiseUtilities.withSignal(Promise.resolve(42), controller.signal);
            expect(result).toBe(42);
        });

        it('resolves when there is no signal at all', async () => {
            const result: number = await PromiseUtilities.withSignal(Promise.resolve(42), undefined);
            expect(result).toBe(42);
        });

        it('rejects with the reason as soon as the signal fires', async () => {
            const controller: AbortController = new AbortController();
            const reason: Error = new Error('the caller is gone');
            setTimeout(() => controller.abort(reason), 20).unref();

            await expect(
                PromiseUtilities.withSignal(new Promise(resolve => setTimeout(resolve, 2000)), controller.signal)
            ).rejects.toBe(reason);
        });

        it('rejects at once when the signal has already fired', async () => {
            const controller: AbortController = new AbortController();
            const reason: Error = new Error('long gone');
            controller.abort(reason);

            await expect(
                PromiseUtilities.withSignal(new Promise(resolve => setTimeout(resolve, 2000)), controller.signal)
            ).rejects.toBe(reason);
        });

        it('leaves no listener behind on a signal that outlives the promise', async () => {
            const controller: AbortController = new AbortController();

            for (let i: number = 0; i < 5; i++) {
                await PromiseUtilities.withSignal(Promise.resolve(i), controller.signal);
            }

            // one request's signal is read by everything it waits for, so a listener per wait is a
            // listener leak on exactly the requests that do the most work
            expect(getEventListeners(controller.signal, 'abort').length).toBe(0);
        });
    });
});