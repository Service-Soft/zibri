import { BaseEntity, Entity, Property } from '../../entity';
import { type Version } from '../../types';

@Entity()
export class MigrationEntity implements BaseEntity {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    name!: string;

    @Property.string({ unique: true })
    version!: Version;

    @Property.date()
    ranAt!: Date;
}