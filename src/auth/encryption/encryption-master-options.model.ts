import { BaseDecryptOptions, BaseEncryptOptions, EncryptionStrategyInterface } from './strategies/encryption-strategy.interface';

/**
 * Definition of the key used to encrypt encryption keys.
 */
export type EncryptionMasterKey<TKey> = {
    /**
     * The id of the key.
     */
    id: string,
    /**
     * The actual value.
     */
    value: TKey
};

/**
 * Options on how encryption keys should be encrypted.
 */
export type EncryptionMasterOptions<
    TKey,
    TEncryptOptions extends BaseEncryptOptions<TKey> = BaseEncryptOptions<TKey>,
    TDecryptOptions extends BaseDecryptOptions<TKey> = BaseEncryptOptions<TKey>
> = {
    /**
     * The current master key for encrypting encryption keys.
     */
    currentMasterKey: EncryptionMasterKey<TKey>,
    /**
     * The strategy that is used to encrypt encryption keys.
     */
    currentMasterStrategy: EncryptionStrategyInterface<TKey, TEncryptOptions, TDecryptOptions>,
    /**
     * Any old master keys.
     */
    oldMasterKeys?: EncryptionMasterKey<unknown>[],
    /**
     * Any old master strategies.
     */
    oldMasterStrategies?: EncryptionStrategyInterface<unknown>[]
};