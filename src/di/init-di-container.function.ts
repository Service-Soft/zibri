import { GlobalRegistry } from '../global/global-registry';
import { ZIBRI_DI_PROVIDERS } from './default/zibri-di-providers.default';
import { ZIBRI_DI_TOKENS } from './default/zibri-di-tokens.default';
import { DiProvider } from './models/di-provider.model';
import { providersFromTokenRecord } from './models/di-token.model';
import { register } from './register.function';

/**
 * Initializes the di container with the registered injectables.
 */
export function initDiContainer(): void {
    const defaultProviders: DiProvider<unknown>[] = providersFromTokenRecord(ZIBRI_DI_TOKENS, ZIBRI_DI_PROVIDERS);
    for (const provider of defaultProviders) {
        register(provider);
    }
    for (const injectable of GlobalRegistry.injectables) {
        register(injectable);
    }
}