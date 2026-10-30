import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Where a chain starts once its oldest rows were removed: the place and the hash of the last row
 * removed, which the next row was linked to.
 */
@Entity({ tenant: 'shared', allowOrphan: true, uniques: [['tableName', 'chain']] })
export class ChainAnchor extends BaseEntity {
    /**
     * The table of the chained entity.
     */
    @Property.string()
    tableName!: string;
    /**
     * The tenant the chain belongs to, or an empty string for the chain of the rows of no tenant.
     */
    @Property.string()
    chain!: string;
    /**
     * The place of the last row removed.
     */
    @Property.number({ format: 'integer' })
    sequence!: number;
    /**
     * The hash of the last row removed.
     */
    @Property.string()
    hash!: string;
    /**
     * The keyed hash of the anchor itself, so an anchor written without the key is told apart.
     */
    @Property.string()
    seal!: string;
}

/**
 * The data a chain anchor is created with.
 */
export type ChainAnchorCreateData = OmitStrict<ChainAnchor, 'id'>;