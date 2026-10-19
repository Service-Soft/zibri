import { EncryptionKey, EncryptionKeyCreateData } from './encryption-key.model';
import { EncryptionString } from './encryption.utilities';
import { KeysInUse } from './keys-in-use.model';
import { RetiredKeyUsage } from './retired-key-usage.model';
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
     * The strategy to use, or undefined for the default one.
     */
    strategy?: Newable<EncryptionStrategyInterface<TKey, TEncryptOptions>>,
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
     * Encrypts a key, given as base64, with the current master key.
     *
     * `masterDecrypt` reads it back without anything stored in a data source, so a key encrypted this
     * way can be read while the data sources are empty or being replaced.
     */
    masterEncrypt: (keyBase64: string) => EncryptionString | Promise<EncryptionString>,
    /**
     * Decrypts a key encrypted with `masterEncrypt`, under the current or one of the old master keys.
     * The key comes back as base64.
     */
    masterDecrypt: (encrypted: EncryptionString) => string | Promise<string>,
    /**
     * Retires a key, so that everything encrypted with it is rewritten under the current one.
     *
     * The rewriting is what `EncryptionRotationCronJob` does, in the background, a bounded number of
     * rows at a time. Once it has nothing left to do the key can be deleted. Deprecating the default
     * key is refused: something has to be the key new values are written with.
     */
    deprecateKey: (keyId: string, options?: BaseRepositoryOptions) => void | Promise<void>,
    /**
     * Checks whether or not the given encryption string should be re-encrypted.
     *
     * True when it was written with a strategy or a key that has since been deprecated, and - when
     * the caller says the value should be bound to its row - when it carries no such binding. The
     * second is not something the value can answer on its own: a property may have asked not to be
     * bound, and sweeping those would never finish.
     */
    needsReEncryption: (encrypted: EncryptionString, shouldBeBoundToRow?: boolean) => boolean | Promise<boolean>,
    /**
     * Resolves the keys that whatever is encrypted right now depends on: the current master key, every
     * master key a data key is still encrypted under, the data keys, and the data source they are
     * stored in.
     */
    resolveKeysInUse: () => Promise<KeysInUse>,
    /**
     * Finds the data keys being retired: every key that is deprecated or belongs to a deprecated
     * strategy.
     */
    findRetiredKeyIds: () => Promise<string[]>,
    /**
     * Counts what is still encrypted under the data keys, master keys and master strategies being
     * retired, which says when a rotation is done.
     *
     * Counted are the values of the encrypted properties of the current models, the data keys, and the
     * recorded backups. A value encrypted by calling `encrypt` directly, or held by a column no current
     * model declares, is not seen, and neither is a backup the transports hold that is not recorded.
     *
     * Reads every row of every entity holding an encrypted property, so it costs as much as one full
     * pass of `EncryptionRotationCronJob`. The rows that job could not rewrite are named per key.
     */
    resolveRetiredKeyUsage: () => Promise<RetiredKeyUsage>
}