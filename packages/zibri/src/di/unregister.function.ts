import { DiContainer } from './di-container.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { GlobalRegistry } from '../global/global-registry.ts';
import { DiToken } from './models/di-token.model.ts';

/**
 * Removes the provided token from the dependency injection system.
 * @param token - The token to unregister.
 * @throws When the app is initialized or started.
 */
export function unregister<T>(token: DiToken<T>): void {
    if (GlobalRegistry.isAppInitialized() || GlobalRegistry.isAppStarted()) {
        throw new InternalError('You can only unregister providers before the app has been initialized');
    }
    const di: DiContainer = DiContainer.getInstance();
    di.unregister(token);
}