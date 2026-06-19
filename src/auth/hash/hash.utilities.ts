import { InternalError } from '../../error-handling/internal-error.model';

/**
 * A string with hashed data stored inside of it.
 */
export type HashString = string & {
    // eslint-disable-next-line jsdoc/require-jsdoc
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