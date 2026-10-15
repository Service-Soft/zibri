import { AsyncLocalStorage } from 'node:async_hooks';

import { CacheContext } from './cache/cache.context';
import { HttpRequestContext } from './request/http-request.context';
import { WebsocketRequestContext } from './request/websocket-request.context';
import { type Transaction } from '../data-source/transaction/transaction.model';
import { type TraceSpanContext } from '../tracing/trace-span-context.model';
import { type TraceSpanInterface } from '../tracing/trace-span.interface';

/**
 * What a held section returned, together with the transactions it wrote to while it ran.
 */
export type LeaseScopeResult<T> = {
    /**
     * The result of the function.
     */
    result: T,
    /**
     * Every transaction a repository wrote to while the function was running.
     */
    transactions: Transaction[]
};

/**
 * Encapsulates functionality around async local storage.
 */
export abstract class AlsUtilities {
    private static readonly httpRequest: AsyncLocalStorage<HttpRequestContext> = new AsyncLocalStorage<HttpRequestContext>();
    private static readonly websocketRequest: AsyncLocalStorage<WebsocketRequestContext> = new AsyncLocalStorage<WebsocketRequestContext>();
    private static readonly cacheContext: AsyncLocalStorage<CacheContext[]> = new AsyncLocalStorage<CacheContext[]>();
    private static readonly leaseScope: AsyncLocalStorage<Set<Transaction>> = new AsyncLocalStorage<Set<Transaction>>();
    private static readonly asyncFactory: AsyncLocalStorage<string> = new AsyncLocalStorage<string>();
    private static readonly migration: AsyncLocalStorage<string> = new AsyncLocalStorage<string>();
    private static readonly span: AsyncLocalStorage<TraceSpanInterface> = new AsyncLocalStorage<TraceSpanInterface>();
    private static readonly traceContext: AsyncLocalStorage<TraceSpanContext> = new AsyncLocalStorage<TraceSpanContext>();
    private static readonly tenant: AsyncLocalStorage<string> = new AsyncLocalStorage<string>();

    /**
     * Resolves the currently active request context from the async local storage.
     * @returns The currently active request context.
     * @throws When the async local storage store has not been initialized yet.
     */
    static getCurrentRequestContext(): HttpRequestContext | WebsocketRequestContext | undefined {
        return this.getCurrentHttpRequestContext() ?? this.getCurrentWebsocketRequestContext();
    }

    /**
     * Finds the signal of the request this is running in.
     *
     * What anything that waits reads to find out whether the answer is still wanted. There is none
     * outside a request - a cron tick, a queue pass or startup work is nobody's to give up on - and
     * waiting simply goes on in that case.
     * @returns The signal, or undefined when this is not running inside a request.
     */
    static findCurrentRequestSignal(): AbortSignal | undefined {
        return this.getCurrentRequestContext()?.signal;
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
     * Runs the given factory marked as belonging to the asynchronous provider for the given token.
     *
     * The mark is what tells `inject()` that it is being called somewhere its answer would depend on
     * what happens to have been built already. Async local storage rather than a flag, because a
     * factory awaits: everything after the first `await` is still inside it, and a flag set around
     * the call would have been cleared by then.
     * @param token - The name of the token whose factory is being run.
     * @param fn - The factory to run.
     * @returns What the factory resolved to.
     */
    static async runInAsyncFactory<T>(token: string, fn: () => Promise<T>): Promise<T> {
        return this.asyncFactory.run(token, fn);
    }

    /**
     * Resolves the asynchronous provider whose factory is running right now.
     * @returns The name of its token, or undefined when nothing is being built asynchronously.
     */
    static getCurrentAsyncFactory(): string | undefined {
        return this.asyncFactory.getStore();
    }

    /**
     * Runs the given function as a step of a migration.
     * @param name - The name of the migration.
     * @param fn - The function to run.
     * @returns What the function resolved to.
     */
    static async runInMigration<T>(name: string, fn: () => Promise<T>): Promise<T> {
        return this.migration.run(name, fn);
    }

    /**
     * Resolves the migration running right now.
     * @returns Its name, or undefined when no migration is running.
     */
    static getCurrentMigration(): string | undefined {
        return this.migration.getStore();
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

    /**
     * Runs the given function while collecting every transaction written to inside it.
     *
     * Used by `withLease` to find out whether a write made while the grant was held is actually
     * going to land before the grant is released.
     * @param fn - The function to run.
     * @returns The result of the function, and the transactions that were written to while it ran.
     */
    static async runInLeaseScope<T>(fn: () => Promise<T>): Promise<LeaseScopeResult<T>> {
        const written: Set<Transaction> = new Set();
        // a nested grant gets its own set rather than the outer one, so each one is only judged on
        // the writes made while it was the innermost one
        const result: T = await this.leaseScope.run(written, fn);
        return { result, transactions: [...written] };
    }

    /**
     * Records that a repository wrote to the given transaction, when that happens under a lease.
     *
     * A no-op outside one, which is the common case.
     * @param transaction - The transaction that was written to.
     */
    static recordTransactionInLeaseScope(transaction: Transaction): void {
        this.leaseScope.getStore()?.add(transaction);
    }

    /**
     * Runs the given function with the span saved in async local storage.
     *
     * What makes a span the parent of the spans started inside it, without anything having to be
     * passed down: every await inside the function is still inside it.
     * @param span - The span being recorded.
     * @param fn - The function to run.
     * @returns The result of the function.
     */
    static runWithSpan<T>(span: TraceSpanInterface, fn: () => T): T {
        return this.span.run(span, fn);
    }

    /**
     * Resolves the span currently being recorded.
     * @returns The span, or undefined when nothing is being recorded here.
     */
    static getCurrentSpan(): TraceSpanInterface | undefined {
        return this.span.getStore();
    }

    /**
     * Runs the given function with the trace context saved in async local storage.
     *
     * Separate from the span, because a trace context exists whether or not anything records spans:
     * an application with no tracer registered still gives its log lines a trace to belong to and
     * still passes one on to the services it calls.
     * @param context - The trace context.
     * @param fn - The function to run.
     * @returns The result of the function.
     */
    static runWithTraceContext<T>(context: TraceSpanContext, fn: () => T): T {
        return this.traceContext.run(context, fn);
    }

    /**
     * Resolves the trace context established for the work running here.
     * @returns The context, or undefined outside any traced work.
     */
    static getCurrentTraceContext(): TraceSpanContext | undefined {
        return this.traceContext.getStore();
    }

    /**
     * Runs the given function with the given tenant active.
     *
     * Everything inside it - every await, every repository call - reaches the rows of that tenant and
     * no other. A tenant set inside another replaces it for as long as the inner function runs.
     * @param tenantId - The id of the tenant to act in.
     * @param fn - The function to run.
     * @returns The result of the function.
     */
    static runInTenant<T>(tenantId: string, fn: () => T): T {
        return this.tenant.run(tenantId, fn);
    }

    /**
     * Resolves the tenant the work running here acts in.
     * @returns The id of the tenant, or undefined when no tenant is active.
     */
    static getCurrentTenant(): string | undefined {
        return this.tenant.getStore();
    }
}