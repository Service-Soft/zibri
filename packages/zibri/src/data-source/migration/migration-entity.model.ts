import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { type SemVerVersion } from '../../versioning/sem-ver.utilities';

/**
 * The migration entity that is stored in the db.
 */
// every data source keeps track of its own migrations, so this entity is duplicated by design
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class MigrationEntity extends BaseEntity {
    /**
     * The name of the migration, which is which migration this is.
     *
     * Unique, because it is the identity: whether a migration has been applied, and which record a
     * revert removes, are both answered by it.
     */
    @Property.string({ unique: true })
    name!: string;

    /**
     * The version at which this migration should run.
     *
     * Says which app versions the schema state belongs to, and nothing about which migration this
     * is - so several migrations share one whenever a release carries more than one schema change,
     * which is the ordinary case.
     */
    @Property.string()
    version!: SemVerVersion;

    /**
     * The timestamp at which the migration ran.
     */
    @Property.date()
    ranAt!: Date;
}