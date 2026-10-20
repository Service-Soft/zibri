import { InternalError } from '../../error-handling/internal-error.model.ts';

/**
 * The longest password the builtin auth routes accept, in characters.
 *
 * Bounds what a single login or password reset hashes. Use it on your own password fields too, so
 * a password set through them is one the builtin routes accept.
 */
// 1024 rather than the 64 NIST asks verifiers to permit at least: far past any passphrase or
// password manager output, and still small enough that a key derivation over it costs what one
// over a normal password does
export const PASSWORD_MAX_LENGTH: number = 1024;

/**
 * A string with hashed data stored inside of it.
 */
export type HashString = string & {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    __brand: 'hash'
};

/**
 * The content stored inside a hashed string.
 */
export type HashContent = {
    /**
     * The name of the hash strategy.
     */
    strategyName: string,
    /**
     * The version of the hash strategy.
     */
    version: string,
    /**
     * The actual hashed value.
     */
    hashedValue: string
};

/**
 * Utilities around handling hashing.
 */
export abstract class HashUtilities {
    /**
     * Creates a hash string from the given content.
     * @param data - The content to store inside the hash string.
     * @returns The hash string in the form "strategyName.version.hashedValue".
     */
    static contentToHash(data: HashContent): HashString {
        return [data.strategyName, data.version, data.hashedValue].join('.') as HashString;
    }
    /**
     * Resolves the content of the given hash string.
     * @param hash - The hash string to resolve the content of.
     * @returns The hash content inside the given string.
     * @throws If the hash string is invalid.
     */
    static hashToContent(hash: HashString): HashContent {
        const [strategyName, version, ...hashedValueParts] = hash.split('.');
        const hashedValue: string = hashedValueParts.join('.');

        if (!strategyName || !version || !hashedValue) {
            throw new InternalError('Invalid hash string');
        }

        return {
            strategyName,
            version,
            hashedValue
        };
    }
}