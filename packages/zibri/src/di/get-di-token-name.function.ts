import { DiToken } from './models/di-token.model';

/**
 * Gets the name of the given token.
 * @param token - The token to get the name of.
 * @returns The key if its an injection token or the name of the class if its a class.
 */
export function getDiTokenName<T>(token: DiToken<T>): string {
    return '__brand' in token
        ? token.key
        // the class's own name. Its constructor is Function, which every class shares
        : token.name;
}