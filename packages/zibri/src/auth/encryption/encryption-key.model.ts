import { type EncryptionString } from './encryption.utilities';
import { EncryptionStrategyEntity } from './strategies/encryption-strategy-entity.model';
import { whereFor } from '../../data-source/models/where/where-for.function';
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
@Entity({ tenant: 'shared', allowOrphan: true })
export class EncryptionKey extends BaseEntity {
    /**
     * The actual key value, stored encrypted.
     */
    @Property.string()
    value!: EncryptionString;
    /**
     * The encryption strategy that this key belongs to.
     */
    @Property.manyToOne({ target: () => EncryptionStrategyEntity, joinColumn: 'strategyId', inverseSide: 'keys' })
    strategy!: EncryptionStrategyEntity;
    /**
     * The id of the strategy that this key belongs to.
     *
     * A strategy has one default key, which is what makes this the identity of that key: an
     * insert-or-get on it lands on the key already in use rather than adding a second one. The
     * other statuses are deliberately outside it - a strategy keeps as many active and deprecated
     * keys as it has rotated through.
     */
    @Property.string({ format: 'uuid', unique: { where: whereFor<EncryptionKey>({ status: EncryptionKeyStatus.DEFAULT }) } })
    strategyId!: string;
    /**
     * The status of the key.
     */
    @Property.string({ enum: EncryptionKeyStatus })
    status!: EncryptionKeyStatus;
}

/**
 * The data for creating a new key.
 */
export type EncryptionKeyCreateData = OmitStrict<EncryptionKey, 'id' | 'strategy' | 'strategyId' | 'status'>
    & DeepPartial<Pick<EncryptionKey, 'strategy'>>
    & {
        /**
         * The status of the key.
         */
        status: ExcludeStrict<EncryptionKeyStatus, EncryptionKeyStatus.DEPRECATED>
    };