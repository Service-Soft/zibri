import { EncryptionString } from '../encryption.utilities';

/**
 * The base options required for encrypting a value.
 */
export type BaseEncryptOptions<TKey> = {
    /**
     * The id of the key to use.
     */
    keyId: string,
    /**
     * The actual key value.
     */
    key: TKey
};

/**
 * The base options required for decrypting a value.
 */
export type BaseDecryptOptions<TKey> = {
    /**
     * The id of the key to use.
     */
    keyId: string,
    /**
     * The actual key value.
     */
    key: TKey
};

/**
 * Interface for an encryption strategy.
 */
export interface EncryptionStrategyInterface<
    TKey,
    TEncryptOptions extends BaseEncryptOptions<TKey> = BaseEncryptOptions<TKey>,
    TDecryptOptions extends BaseDecryptOptions<TKey> = BaseDecryptOptions<TKey>
> {
    /**
     * The name of the strategy.
     */
    readonly name: string,
    /**
     * The version of the strategy.
     */
    readonly version: string,
    /**
     * Encrypts the given value with the given options.
     */
    encrypt: (value: string, options: TEncryptOptions) => EncryptionString | Promise<EncryptionString>,
    /**
     * Decrypts the given value with the given options.
     */
    decrypt: (value: EncryptionString, options: TDecryptOptions) => string | Promise<string>,
    /**
     * Generates a new random key.
     */
    generateRandomKey: () => TKey | Promise<TKey>,
    /**
     * Serializes the given key into a Buffer.
     */
    serializeKey: (key: TKey) => Buffer | Promise<Buffer>,
    /**
     * Resolves a key from the given Buffer.
     */
    deserializeKey: (raw: Buffer) => TKey | Promise<TKey>
}