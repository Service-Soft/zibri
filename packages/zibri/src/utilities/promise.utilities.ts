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
    /**
     * How many items are worked on at once when the caller does not say.
     *
     * Sized against the data source pool rather than against anything here, because most of what is
     * chunked ends in a query and the pool is what decides how many of those actually run. Above the
     * pool on purpose: a chunk is a barrier, so sizing it to exactly fill the pool leaves every
     * connection idle waiting for the slowest item of the batch, where a queue behind the pool hands
     * each freed connection its next item immediately. Far above the pool would buy nothing on the
     * database and cost the heap, since everything queued is held until its turn.
     *
     * A caller that knows better passes its own. See `docs/replication.md`.
     */
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
        fn: (item: T) => R | Promise<R>,
        options?: ChunkingOptions
    ): Promise<Awaited<R>[]> {
        const results: Awaited<R>[] = [];

        for (const chunk of this.resolveChunks(items, options?.chunkSize ?? this.defaultChunkSize)) {
            const promises: (R | Promise<R>)[] = chunk.map(fn);
            results.push(...await Promise.all(promises));
        }

        return results;
    }

    /**
     * Splits items into consecutive chunks, keeping their order.
     * @param items - The items to split.
     * @param chunkSize - How many items one chunk holds at most.
     * @returns The chunks, every one full except possibly the last.
     */
    static resolveChunks<T>(items: T[], chunkSize: number): T[][] {
        const res: T[][] = [];
        for (let i: number = 0; i < items.length; i += chunkSize) {
            res.push(items.slice(i, i + chunkSize));
        }
        return res;
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
        fn: (item: T) => boolean | Promise<boolean>,
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
     * @param signal - A signal that ends the wait before the timeout does, if it fires first.
     * @returns The result of the function if finished in time.
     */
    static async withTimeout<T>(
        promise: (signal: AbortSignal) => T | Promise<T>,
        timeoutInMs: number,
        signal?: AbortSignal
    ): Promise<T> {
        const ac: AbortController = new AbortController();
        // what the work is handed fires for either reason, because from the work's side there is no
        // difference: it has stopped being worth finishing
        const combined: AbortSignal = signal ? AbortSignal.any([ac.signal, signal]) : ac.signal;
        const timeoutFn: () => Promise<never> = async () => {
            await setTimeout(timeoutInMs, undefined, { signal: ac.signal });
            throw new TimeoutError();
        };

        try {
            const res: T = await this.withSignal(
                Promise.race([
                    Promise.resolve().then(() => promise(combined)),
                    timeoutFn()
                ]),
                signal
            );

            ac.abort();
            return res;
        }
        catch (error) {
            ac.abort();
            throw error;
        }
    }

    /**
     * Stops waiting for the given promise as soon as the signal fires.
     *
     * The promise itself is not stopped - nothing can stop a promise. What this ends is the waiting,
     * which is what matters when the answer has stopped being worth having. Whatever was handed the
     * same signal ends itself.
     * @param promise - What is being waited for.
     * @param signal - The signal that ends the wait, or undefined to simply wait.
     * @returns The result, when it arrives first.
     * @throws The signal's reason, when that fires first.
     */
    static async withSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
        if (!signal) {
            return await promise;
        }
        if (signal.aborted) {
            throw signal.reason;
        }

        // held in an object so that the listener taken off again is the one that went on. One
        // request's signal is read by everything that request waits for, so a listener left behind
        // per wait is a leak on exactly the requests doing the most work
        // eslint-disable-next-line jsdoc/require-jsdoc
        const listener: { onAbort: () => void } = { onAbort: () => {} };
        const aborted: Promise<never> = new Promise<never>((_resolve, reject) => {
            listener.onAbort = () => reject(signal.reason);
            signal.addEventListener('abort', listener.onAbort, { once: true });
        });

        try {
            return await Promise.race([promise, aborted]);
        }
        finally {
            signal.removeEventListener('abort', listener.onAbort);
        }
    }
}