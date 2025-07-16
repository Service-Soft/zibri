import { GlobalRegistry } from '../global';
import { DiContainer } from './di-container';
import { DiProvider } from './models';

/**
 * Registers a new DI provider.
 * @param provider - The provider to register.
 * @throws When the app is initialized or running.
 */
export function register<T>(provider: DiProvider<T>): void {
    if (GlobalRegistry.isAppInitialized() || GlobalRegistry.isAppRunning()) {
        throw new Error('You can only register providers before the app has been initialized');
    }
    const di: DiContainer = DiContainer.getInstance();
    di.register(provider);
}