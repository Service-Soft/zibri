import { GlobalRegistry } from '../global';
import { DiContainer } from './di-container';
import { DiToken } from './models';

/**
 * Removes the provided token from the dependency injection system.
 * @param token - The token to unregister.
 * @throws When the app is initialized or running.
 */
export function unregister<T>(token: DiToken<T>): void {
    if (GlobalRegistry.isAppInitialized() || GlobalRegistry.isAppRunning()) {
        throw new Error('You can only unregister providers before the app has been initialized');
    }
    const di: DiContainer = DiContainer.getInstance();
    di.unregister(token);
}