import { AsyncLocalStorage } from 'node:async_hooks';

import { CacheContext } from './cache/cache.context';
import { HttpRequestContext } from './request/http-request.context';
import { WebsocketRequestContext } from './request/websocket-request.context';

/**
 * Encapsulates functionality around async local storage.
 */
export abstract class AlsUtilities {
    private static readonly httpRequest: AsyncLocalStorage<HttpRequestContext> = new AsyncLocalStorage<HttpRequestContext>();
    private static readonly websocketRequest: AsyncLocalStorage<WebsocketRequestContext> = new AsyncLocalStorage<WebsocketRequestContext>();
    private static readonly cacheContext: AsyncLocalStorage<CacheContext[]> = new AsyncLocalStorage<CacheContext[]>();

    /**
     * Resolves the currently active request context from the async local storage.
     * @returns The currently active request context.
     * @throws When the async local storage store has not been initialized yet.
     */
    static getCurrentRequestContext(): HttpRequestContext | WebsocketRequestContext | undefined {
        return this.getCurrentHttpRequestContext() ?? this.getCurrentWebsocketRequestContext();
    }

    /**
     * Runs the given function with the request context saved in async local storage.
     * @param context - The request context.
     * @param fn - The function to run.
     * @returns The result of the function.
     */
    static runWithHttpRequestContext<T>(context: HttpRequestContext, fn: () => T): T {
        return this.httpRequest.run(context, fn);
    }

    /**
     * Resolves the currently active request context from the async local storage.
     * @returns The currently active http request context.
     * @throws When the async local storage store has not been initialized yet.
     */
    protected static getCurrentHttpRequestContext(): HttpRequestContext | undefined {
        const store: HttpRequestContext | undefined = this.httpRequest.getStore();
        return store;
    }

    /**
     * Runs the given function with the request context saved in async local storage.
     * @param context - The request context.
     * @param fn - The function to run.
     * @returns The result of the function.
     */
    static runWithWebsocketRequestContext<T>(context: WebsocketRequestContext, fn: () => T): T {
        return this.websocketRequest.run(context, fn);
    }

    /**
     * Resolves the currently active request context from the async local storage.
     * @returns The currently active websocket request context.
     * @throws When the async local storage store has not been initialized yet.
     */
    protected static getCurrentWebsocketRequestContext(): WebsocketRequestContext | undefined {
        const store: WebsocketRequestContext | undefined = this.websocketRequest.getStore();
        return store;
    }

    /**
     * Runs the given function with the cache context saved in async local storage.
     * @param context - The cache context.
     * @param fn - The function to run.
     * @returns The result of the function.
     */
    static runWithCacheContext<T>(context: CacheContext, fn: () => T): T {
        const existing: CacheContext[] = this.getCurrentCacheContext() ?? [];
        // New array — doesn't mutate the parent scope's array
        return this.cacheContext.run([...existing, context], fn);
    }

    /**
     * Resolves the currently active cache context from the async local storage.
     * @returns The currently active cache context.
     * @throws When the async local storage store has not been initialized yet.
     */
    static getCurrentCacheContext(): CacheContext[] | undefined {
        return this.cacheContext.getStore();
    }
}