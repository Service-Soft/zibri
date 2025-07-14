import { BaseEntity, Entity, Property } from '../../entity';
import { type Version } from '../../types';

/**
 * The migration entity that is stored in the db.
 */
@Entity()
export class MigrationEntity implements BaseEntity {
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string({ primary: true })
    id!: string;

    /**
     * The name of the migration.
     */
    @Property.string({ unique: true })
    name!: string;

    /**
     * The version at which this migration should run.
     */
    @Property.string({ unique: true })
    version!: Version;

    /**
     * The timestamp at which the migration ran.
     */
    @Property.date()
    ranAt!: Date;
}