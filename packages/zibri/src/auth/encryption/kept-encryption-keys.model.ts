import { EncryptionKey } from './encryption-key.model';
import { SigningKey } from './signing-key.model';
import { EncryptionStrategyEntity } from './strategies/encryption-strategy-entity.model';

/**
 * The keys stored when a restore of the data source holding them begins, which the restore keeps beside
 * those of the backup. The value of each key is encrypted by the master key, as it is stored.
 */
export type KeptEncryptionKeys = {
    /**
     * The rows of the strategies.
     */
    strategies: Pick<EncryptionStrategyEntity, 'id' | 'name' | 'version' | 'status'>[],
    /**
     * The keys of the strategies.
     */
    keys: Pick<EncryptionKey, 'id' | 'value' | 'strategyId' | 'status'>[],
    /**
     * The signing keys.
     */
    signingKeys: Pick<SigningKey, 'id' | 'name' | 'value'>[]
};