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
     * Whatever the strategy needs in order to use this key.
     *
     * Deliberately typed by the strategy rather than by the framework, so it does not have to be key
     * material. A strategy backed by a kms or an hsm makes this a key handle - an arn, a label, a
     * slot - and never has the bytes in process at all. Nothing here inspects it.
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
     *
     * The key type is `any` because this is a list of strategies that do not share one: an
     * application moving from aes-gcm to a kms backed strategy has a `Buffer` keyed one and a handle
     * keyed one in here at the same time. Written as `EncryptionStrategyInterface<unknown>` the list
     * accepts neither of them - a strategy that needs a `Buffer` cannot be handed an `unknown` - so
     * nothing could be put in it without a cast at the call site.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    oldMasterStrategies?: EncryptionStrategyInterface<any>[]
};