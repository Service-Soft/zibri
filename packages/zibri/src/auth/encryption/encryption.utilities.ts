import { InternalError } from '../../error-handling/internal-error.model';

/**
 * A string with encrypted data stored inside of it.
 */
export type EncryptionString = string & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    __brand: 'encryption'
};

/**
 * The content stored inside an encryption string.
 */
export type EncryptionContent = {
    /**
     * The name of the encryption strategy.
     */
    strategyName: string,
    /**
     * The version of the encryption strategy.
     */
    version: string,
    /**
     * The id of the key that has been used.
     */
    keyId: string,
    /**
     * The actual encrypted value.
     */
    encryptedValue: string
};

/**
 * Utilities around handling encryption.
 */
export abstract class EncryptionUtilities {
    /**
     * Creates an encryption string from the given content.
     * @param data - The content to store inside the encryption string.
     * @returns The encryption string in the form "strategyName.version.encryptedValue".
     */
    static contentToEncryptionString(data: EncryptionContent): EncryptionString {
        return [data.strategyName, data.version, data.keyId, data.encryptedValue].join('.') as EncryptionString;
    }
    /**
     * Resolves the content of the given encryption string.
     * @param encrypted - The encryption string to resolve the content of.
     * @returns The encryption content inside the given string.
     * @throws If the encryption string is invalid.
     */
    static encryptionStringToContent(encrypted: EncryptionString): EncryptionContent {
        const [strategyName, version, keyId, ...encryptedValueParts] = encrypted.split('.');
        const encryptedValue: string = encryptedValueParts.join('.');

        if (!strategyName || !version || !keyId || !encryptedValue) {
            throw new InternalError('Invalid encryption string');
        }

        return {
            strategyName,
            version,
            keyId,
            encryptedValue
        };
    }
}