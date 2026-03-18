import { DiContainer } from './di-container';
import { GlobalRegistry } from '../global/global-registry';
import { DiToken } from './models/di-token.model';

/**
 * Removes the provided token from the dependency injection system.
 * @param token - The token to unregister.
 * @throws When the app is initialized or started.
 */
export function unregister<T>(token: DiToken<T>): void {
    if (GlobalRegistry.isAppInitialized() || GlobalRegistry.isAppStarted()) {
        throw new Error('You can only unregister providers before the app has been initialized');
    }
    const di: DiContainer = DiContainer.getInstance();
    di.unregister(token);
}