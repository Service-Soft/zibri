import { Entity, Property } from '../entity';
import { BackupEntity } from './backup-entity.model';
import { BaseEntity } from '../entity/base-entity.model';
import { OmitStrict } from '../types';

/**
 * A single resource entity.
 */
@Entity()
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
    size: number | undefined;
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
    @Property.belongsToOne({ target: () => BackupEntity, inverseSide: 'resources' })
    backup!: BackupEntity;
}

/**
 * The data required to create a new backup resource.
 */
export type BackupResourceEntityCreateData = OmitStrict<BackupResourceEntity, 'id' | 'completed' | 'backup' | 'size'>;