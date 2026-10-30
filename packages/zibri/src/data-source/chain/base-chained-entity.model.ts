import { BaseEntity } from '../../entity/base-entity.model';
import { Property } from '../../entity/decorators/property.decorator';

/**
 * The base of an entity declared with `chained: true`, holding where each row stands in its chain.
 * The repository fills both in when a row is created.
 */
export class BaseChainedEntity extends BaseEntity {
    /**
     * The place of the row in its chain, counting from 1.
     */
    @Property.number({ format: 'integer' })
    chainSequence!: number;
    /**
     * The keyed hash of the row's content and of the hash of the row before it.
     */
    @Property.string()
    chainHash!: string;
}