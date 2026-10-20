import { DiContainer } from './di-container.ts';
import { DiToken } from './models/di-token.model.ts';

/**
 * Gets all registered DI tokens.
 * @returns The tokens as an array.
 */
export function getAllRegisteredTokens(): DiToken<unknown>[] {
    return DiContainer.getInstance().getAllRegisteredTokens();
}