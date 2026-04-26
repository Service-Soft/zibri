import { type EncryptionString } from './encryption.utilities';
import { EncryptionStrategyEntity } from './strategies/encryption-strategy-entity.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { DeepPartial } from '../../types/deep-partial.type';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * The status that an encryption key can have.
 */
export enum EncryptionKeyStatus {
    ACTIVE = 'ACTIVE',
    DEFAULT = 'DEFAULT',
    DEPRECATED = 'DEPRECATED'
}

/**
 * A key used for encrypting data.
 */
@Entity({ allowOrphan: true })
export class EncryptionKey extends BaseEntity {
    /**
     * The actual key value, stored encrypted.
     */
    @Property.string()
    value!: EncryptionString;
    /**
     * The encryption strategy that this key belongs to.
     */
    @Property.manyToOne({ target: () => EncryptionStrategyEntity, inverseSide: 'keys' })
    strategy!: EncryptionStrategyEntity;
    /**
     * The status of the key.
     */
    @Property.string({ enum: EncryptionKeyStatus })
    status!: EncryptionKeyStatus;
}

/**
 * The data for creating a new key.
 */
export type EncryptionKeyCreateData = OmitStrict<EncryptionKey, 'id' | 'strategy' | 'status'>
    & DeepPartial<Pick<EncryptionKey, 'strategy'>>
    & {
        /**
         * The status of the key.
         */
        status: ExcludeStrict<EncryptionKeyStatus, EncryptionKeyStatus.DEPRECATED>
    };