import { DiContainer } from './di-container.ts';
import { DiProvider } from './models/di-provider.model.ts';
import { DiVariant } from './models/di-variant.model.ts';

/**
 * Gets all registered DI providers of the given variant.
 * @param variant - The variant to get the providers of.
 * @returns The currently registered providers as an array.
 */
export function getRegisteredProvidersOfVariant(variant: DiVariant): DiProvider<unknown>[] {
    return DiContainer.getInstance().getRegisteredProvidersOfVariant(variant);
}