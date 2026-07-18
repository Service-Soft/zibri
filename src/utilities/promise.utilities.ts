import { setTimeout } from 'node:timers/promises';

import { ExternalError } from '../error-handling/external-error.model';
import { InternalError } from '../error-handling/internal-error.model';
import { TranslatedString } from '../localization/models/translated-string.model';
import { $ts } from '../localization/translate.function';

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
 * An error to throw when an operation runs into a timeout.
 */
export class TimeoutError extends ExternalError {
    constructor(message: TranslatedString = $ts`Timed out`, title = $ts`Timed out`, options?: ErrorOptions) {
        super(message, title, options);
        this.name = 'TimeoutError';
    }
}

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
                        throw new InternalError('not true');
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
    static async withTimeout<T>(
        promise: (signal: AbortSignal) => T | Promise<T>,
        timeoutInMs: number
    ): Promise<T> {
        const ac: AbortController = new AbortController();
        const timeoutFn: () => Promise<never> = async () => {
            await setTimeout(timeoutInMs, undefined, { signal: ac.signal });
            throw new TimeoutError();
        };

        try {
            const res: T = await Promise.race([
                Promise.resolve().then(() => promise(ac.signal)),
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