import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { type SemVerVersion } from '../../utilities/sem-ver.utilities';

/**
 * The migration entity that is stored in the db.
 */
@Entity()
export class MigrationEntity extends BaseEntity {
    /**
     * The name of the migration.
     */
    @Property.string({ unique: true })
    name!: string;

    /**
     * The version at which this migration should run.
     */
    @Property.string({ unique: true })
    version!: SemVerVersion;

    /**
     * The timestamp at which the migration ran.
     */
    @Property.date()
    ranAt!: Date;
}