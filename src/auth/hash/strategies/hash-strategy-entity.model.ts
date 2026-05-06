import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitStrict } from '../../../types/omit-strict.type';

/**
 * The status that a hash strategy can have.
 */
export enum HashStrategyStatus {
    ACTIVE = 'ACTIVE',
    DEFAULT = 'DEFAULT',
    DEPRECATED = 'DEPRECATED'
}

/**
 * The hash strategy entity that is stored in the db.
 */
@Entity({ allowOrphan: true })
export class HashStrategyEntity extends BaseEntity {
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
    @Property.string({ enum: HashStrategyStatus })
    status!: HashStrategyStatus;
}

/**
 * The data for creating a new hash strategy entity.
 */
export type HashStrategyEntityCreateData = OmitStrict<HashStrategyEntity, 'id'>;