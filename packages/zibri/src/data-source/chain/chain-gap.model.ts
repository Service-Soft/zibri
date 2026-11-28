import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * A row removed from inside its chain, which the check steps over: its place and its hash, which the
 * row after it was linked to.
 */
@Entity({ tenant: 'shared', allowOrphan: true, uniques: [['tableName', 'chain', 'sequence']] })
export class ChainGap extends BaseEntity {
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
     * The place of the removed row.
     */
    @Property.number({ format: 'integer' })
    sequence!: number;
    /**
     * The hash of the removed row.
     */
    @Property.string()
    hash!: string;
    /**
     * The keyed hash of the gap itself, so a gap written without the key is told apart.
     */
    @Property.string()
    seal!: string;
}

/**
 * The data a chain gap is created with.
 */
export type ChainGapCreateData = OmitStrict<ChainGap, 'id'>;