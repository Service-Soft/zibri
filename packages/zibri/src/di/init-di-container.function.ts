import { validateSingleFrameworkCopy } from '../global/framework-copies';
import { GlobalRegistry } from '../global/global-registry';
import { ZIBRI_DI_PROVIDERS } from './default/zibri-di-providers.default';
import { ZIBRI_DI_TOKENS } from './default/zibri-di-tokens.default';
import { DiProvider } from './models/di-provider.model';
import { DiToken } from './models/di-token.model';
import { register } from './register.function';
import { ObjectUtilities } from '../utilities/object.utilities';

/**
 * Initializes the di container with the registered injectables.
 */
export function initDiContainer(): void {
    // before anything is registered, because a second copy registers into a container of its own -
    // and half the application ending up in the other one is what this refuses to let happen quietly
    validateSingleFrameworkCopy();
    for (const key of ObjectUtilities.keys(ZIBRI_DI_TOKENS)) {
        const token: DiToken<unknown> = ZIBRI_DI_TOKENS[key];
        const { register: registration, ...defaultProvider } = ZIBRI_DI_PROVIDERS[key];
        const provider: DiProvider<unknown> = { token, ...defaultProvider };
        if (registration !== 'onUse') {
            register(provider);
            continue;
        }
        // with the classes registered on use, found by the first injection of the token. Once only,
        // as the registry outlives every container, and not over one declared there already
        if (!GlobalRegistry.lazyInjectables.some(lazy => lazy.token === token)) {
            GlobalRegistry.lazyInjectables.push(provider);
        }
    }
    for (const injectable of GlobalRegistry.injectables) {
        register(injectable);
    }
}
