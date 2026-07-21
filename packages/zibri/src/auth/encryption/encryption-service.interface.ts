import { EncryptionKey, EncryptionKeyCreateData } from './encryption-key.model';
import { EncryptionString } from './encryption.utilities';
import { BaseEncryptOptions, EncryptionStrategyInterface } from './strategies/encryption-strategy.interface';
import { BaseRepositoryOptions } from '../../data-source/models/options/base-repository-options.model';
import { Where } from '../../data-source/models/where/where-filter.model';
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
 * Additional options for deleting encryption keys.
 */
export type DeleteEncryptionKeyOptions = BaseRepositoryOptions & {
    /**
     * Whether or not it is allowed to delete the default key.
     */
    allowDefault?: boolean
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
    decrypt: <TDecryptOptions extends BaseRepositoryOptions & AnyObject>(
        value: EncryptionString,
        options?: TDecryptOptions
    ) => string | Promise<string>,
    /**
     * Creates a new encryption key for the given strategy.
     */
    createKey: <TKey>(
        strategy: Newable<EncryptionStrategyInterface<TKey>>,
        data: OmitStrict<EncryptionKeyCreateData, 'strategy' | 'value'>,
        options?: BaseRepositoryOptions
    ) => EncryptionKey | Promise<EncryptionKey>,
    /**
     * Deletes the key with the given id.
     */
    deleteKey: (keyId: string, options?: DeleteEncryptionKeyOptions) => void | Promise<void>,
    /**
     * Deletes all keys that match the given where clause.
     */
    deleteAllKeys: (where: Where<EncryptionKey>, options?: DeleteEncryptionKeyOptions) => void | Promise<void>,
    /**
     * Marks the key with the given id as the default key for the given strategy.
     */
    markKeyAsDefaultForStrategy: <TKey>(
        keyId: string,
        strategy: Newable<EncryptionStrategyInterface<TKey>>,
        options?: BaseRepositoryOptions
    ) => void | Promise<void>,
    /**
     * Decrypts the key of the given strategy.
     */
    decryptKey: <TKey>(
        strategy: Newable<EncryptionStrategyInterface<TKey>>,
        encryptedKey: EncryptionString
    ) => Promise<TKey>,
    /**
     * Checks whether or not the given encryption string should be re-encrypted.
     */
    needsReEncryption: (encrypted: EncryptionString) => boolean | Promise<boolean>
}