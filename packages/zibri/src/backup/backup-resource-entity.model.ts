import { BackupEntity } from './backup-entity.model';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * A single resource entity.
 */
@Entity({ allowOrphan: true })
export class BackupResourceEntity extends BaseEntity {
    /**
     * The name of the resource.
     */
    @Property.string()
    name!: string;
    /**
     * The size of the resource in bytes.
     */
    @Property.number({ required: false })
    size: number | undefined | null;
    /**
     * Whether or not the backup of this resource has been completed.
     */
    @Property.boolean({ default: false })
    completed!: boolean;
    /**
     * The names of the transports that have been used.
     */
    @Property.array({ items: { type: 'string' } })
    transportNames!: string[];
    /**
     * The backup that this resource belongs to.
     */
    @Property.belongsToOne({ target: () => BackupEntity, joinColumn: 'backupId', inverseSide: 'resources' })
    backup!: BackupEntity;
    /**
     * The id of the backup that this resource belongs to.
     */
    @Property.string({ format: 'uuid' })
    backupId!: string;
}

/**
 * The data required to create a new backup resource.
 */
export type BackupResourceEntityCreateData = OmitStrict<BackupResourceEntity, 'id' | 'completed' | 'backup' | 'backupId' | 'size'>;