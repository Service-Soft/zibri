import { DiContainer } from './di-container.ts';
import { DiToken } from './models/di-token.model.ts';

/**
 * Injects the registered value for the provided token.
 * @param token - The token to inject the registered value from.
 * @returns The injected value.
 */
export function inject<T>(token: DiToken<T>): T {
    const di: DiContainer = DiContainer.getInstance();
    return di.inject(token);
}