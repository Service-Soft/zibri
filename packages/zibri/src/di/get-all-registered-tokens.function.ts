import { DiContainer } from './di-container';
import { DiToken } from './models/di-token.model';

/**
 * Gets all registered DI tokens.
 * @returns The tokens as an array.
 */
export function getAllRegisteredTokens(): DiToken<unknown>[] {
    return DiContainer.getInstance().getAllRegisteredTokens();
}