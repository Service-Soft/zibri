import { AsyncLocalStorage } from 'async_hooks';

import { HttpRequest } from '../http';

/**
 * The data stored in async local storage.
 */
type AslData = {
    /**
     * The current http request.
     */
    request: HttpRequest
};

const als: AsyncLocalStorage<AslData> = new AsyncLocalStorage<AslData>();

/**
 * Runs the given function with the request saved in async local storage.
 * @param req - The request.
 * @param fn - The function to run.
 * @returns The result of the function.
 */
export function runWithRequest<T>(req: HttpRequest, fn: () => T): T {
    return als.run({ request: req }, fn);
}

/**
 * Resolves the currently active request from the async local storage.
 * @returns The currently active http request.
 * @throws When the async local storage store has not been initialized yet.
 */
export function getCurrentRequest(): HttpRequest {
    const store: AslData | undefined = als.getStore();
    if (!store) {
        throw new Error('No request in context');
    }
    return store.request;
}