import { DiContainer } from './di-container.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { GlobalRegistry } from '../global/global-registry.ts';
import { DiProvider } from './models/di-provider.model.ts';

/**
 * Registers a new DI provider.
 * @param provider - The provider to register.
 * @throws When the app is initialized or started.
 */
export function register<T>(provider: DiProvider<T>): void {
    if (GlobalRegistry.isAppInitialized() || GlobalRegistry.isAppStarted()) {
        throw new InternalError('You can only register providers before the app has been initialized');
    }
    const di: DiContainer = DiContainer.getInstance();
    di.register(provider);
}