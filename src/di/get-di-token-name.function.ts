import { DiToken } from './models/di-token.model';

/**
 * Gets the name of the given token.
 * @param token - The token to get the name of.
 * @returns The key if its an injection token or the constructor name if its a class.
 */
export function getDiTokenName<T>(token: DiToken<T>): string {
    if ('__brand' in token) {
        return token.key;
    }
    return token.constructor.name;
}