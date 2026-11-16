import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';

/**
 * A row of a `SeededTable`, as a data source measured by the backup benchmarks stores it.
 *
 * Declared by the data sources of the measurements that need one, and by no other.
 */
@Entity({ tenant: 'shared', allowOrphan: true, uniques: [['rowId']] })
export class MeasuredRow {

    @Property.string({ primary: true })
    id!: string;

    /**
     * The row's id in its seeded table.
     */
    @Property.number({ format: 'integer' })
    rowId!: number;

    /**
     * How often the row was written.
     */
    @Property.number({ format: 'integer' })
    version!: number;

    /**
     * The row's content.
     */
    @Property.string()
    text!: string;
}