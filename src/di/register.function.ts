import { DiContainer } from './di-container';
import { GlobalRegistry } from '../global/global-registry';
import { DiProvider } from './models/di-provider.model';

/**
 * Registers a new DI provider.
 * @param provider - The provider to register.
 * @throws When the app is initialized or started.
 */
export function register<T>(provider: DiProvider<T>): void {
    if (GlobalRegistry.isAppInitialized() || GlobalRegistry.isAppStarted()) {
        throw new Error('You can only register providers before the app has been initialized');
    }
    const di: DiContainer = DiContainer.getInstance();
    di.register(provider);
}