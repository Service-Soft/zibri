import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitStrict } from '../../../types/omit-strict.type';
import { EncryptionKey, EncryptionKeyCreateData } from '../encryption-key.model';

/**
 * The status that an encryption strategy can have.
 */
export enum EncryptionStrategyStatus {
    ACTIVE = 'ACTIVE',
    DEFAULT = 'DEFAULT',
    DEPRECATED = 'DEPRECATED'
}

/**
 * The encryption strategy entity that is stored in the db.
 */
@Entity({ allowOrphan: true })
export class EncryptionStrategyEntity extends BaseEntity {
    /**
     * The name of the strategy.
     */
    @Property.string()
    name!: string;
    /**
     * The version of the strategy.
     */
    @Property.string()
    version!: string;
    /**
     * The status of the strategy.
     */
    @Property.string({ enum: EncryptionStrategyStatus })
    status!: EncryptionStrategyStatus;
    /**
     * The keys for this strategy.
     */
    @Property.oneToMany({ target: () => EncryptionKey, inverseSide: 'strategy' })
    keys!: EncryptionKey[];
}

/**
 * The data for creating a new encryption strategy.
 */
export type EncryptionStrategyEntityCreateData = OmitStrict<EncryptionStrategyEntity, 'id' | 'keys'>
    & {
        /**
         * The keys for this strategy.
         */
        keys: EncryptionKeyCreateData[]
    };