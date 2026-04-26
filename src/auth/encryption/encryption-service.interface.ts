import { EncryptionKey, EncryptionKeyCreateData } from './encryption-key.model';
import { EncryptionString } from './encryption.utilities';
import { BaseEncryptOptions, EncryptionStrategyInterface } from './strategies/encryption-strategy.interface';
import { AnyObject } from '../../entity/any-object.model';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Options for encrypting a value.
 */
export type EncryptOptions<TKey, TEncryptOptions extends BaseEncryptOptions<TKey>> = {
    /**
     * The strategy to use.
     */
    strategy: Newable<EncryptionStrategyInterface<TKey, TEncryptOptions>>,
    /**
     * Additional options for that strategy.
     */
    strategyOptions?: Partial<OmitStrict<TEncryptOptions, 'key'>>
};

/**
 * Interface for an encryption service.
 */
export interface EncryptionServiceInterface {
    /**
     * Encrypts the given value using the provided options.
     */
    encrypt: <TKey, TEncryptOptions extends BaseEncryptOptions<TKey>>(
        value: string,
        options?: EncryptOptions<TKey, TEncryptOptions>
    ) => EncryptionString | Promise<EncryptionString>,
    /**
     * Decrypts the given value using the provided options.
     */
    decrypt: <TDecryptOptions extends AnyObject>(
        value: EncryptionString,
        options?: TDecryptOptions
    ) => string | Promise<string>,
    /**
     * Creates a new encryption key for the given strategy.
     */
    createKey: <TKey>(
        strategy: Newable<EncryptionStrategyInterface<TKey>>,
        data: OmitStrict<EncryptionKeyCreateData, 'strategy' | 'value'>
    ) => EncryptionKey | Promise<EncryptionKey>,
    /**
     * Decrypts the key of the given strategy.
     */
    decryptKey: <TKey>(
        strategy: Newable<EncryptionStrategyInterface<TKey>>,
        encryptedKey: EncryptionString
    ) => Promise<TKey>
}