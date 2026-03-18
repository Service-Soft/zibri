import { setTimeout } from 'node:timers/promises';

/**
 * Options for chunking.
 */
export type ChunkingOptions = {
    /**
     * The size of a single chunk.
     */
    chunkSize: number
};

/**
 * Encapsulates functionality for handling promises.
 */
export abstract class PromiseUtilities {
    private static readonly defaultChunkSize: number = 50;

    /**
     * Like Promise.all, but chunked.
     * @param items - The items that are mapped to promises.
     * @param fn - The async function that each item is mapped to.
     * @param options - Options for chunking, like the size of chunks etc.
     * @returns The resolved promises after all chunks have been resolved.
     */
    static async allChunked<T, R>(
        items: T[],
        fn: (item: T) => Promise<R>,
        options?: ChunkingOptions
    ): Promise<Awaited<R>[]> {
        const results: Awaited<R>[] = [];
        const chunkSize: number = options?.chunkSize ?? this.defaultChunkSize;

        for (let i: number = 0; i < items.length; i += chunkSize) {
            const promises: Promise<R>[] = items.slice(i, i + chunkSize).map(fn);
            results.push(...await Promise.all(promises));
        }

        return results;
    }

    /**
     * Like Promise.any, but it doesn't only checks if the promise resolves at all, but if it does so with the value true.
     * @param items - The items that are mapped to promises.
     * @param fn - The async function that each item is mapped to.
     * @param options - Options for chunking, like the size of chunks etc.
     * @returns The first resolved promise that returns "true".
     */
    static async anyValueTrue<T>(
        items: T[],
        fn: (item: T) => Promise<boolean>,
        options?: ChunkingOptions
    ): Promise<boolean> {
        const chunkSize: number = options?.chunkSize ?? this.defaultChunkSize;

        for (let i: number = 0; i < items.length; i += chunkSize) {
            const res: boolean = await Promise.any(
                items.slice(i, i + chunkSize).map(async item => {
                    const r: boolean = await fn(item);
                    if (!r) {
                        throw new Error('not true');
                    }
                    return r;
                })
            ).catch(() => false);
            if (res) {
                return res;
            }
        }

        return false;
    }

    /**
     * Waits for the given promise for a given timeout.
     * @param promise - The promise to await.
     * @param timeoutInMs - The timeout after which an error should be thrown.
     * @returns The result of the function if finished in time.
     */
    static async withTimeout<Res>(
        promise: Res | Promise<Res>,
        timeoutInMs: number
    ): Promise<Res> {
        const ac: AbortController = new AbortController();
        const timeoutFn: () => Promise<never> = async () => {
            await setTimeout(timeoutInMs, undefined, { signal: ac.signal });
            throw new Error('Timed out');
        };

        try {
            const res: Res = await Promise.race([
                promise,
                timeoutFn()
            ]);

            ac.abort();
            return res;
        }
        catch (error) {
            ac.abort();
            throw error;
        }
    }
}