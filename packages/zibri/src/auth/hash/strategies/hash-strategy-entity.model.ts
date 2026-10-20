import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { OmitStrict } from '../../../types/omit-strict.type.ts';

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
@Entity({ tenant: 'shared', allowOrphan: true })
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