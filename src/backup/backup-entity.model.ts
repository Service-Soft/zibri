import { inject, ZIBRI_DI_TOKENS } from '../di';
import { Entity, Property } from '../entity';
import { BackupResourceEntity, BackupResourceEntityCreateData } from './backup-resource-entity.model';
import { BaseEntity } from '../entity/base-entity.model';
import { FormatDateFn } from '../localization';
import { OmitStrict } from '../types';

/**
 * The entity of a single backup.
 */
@Entity()
export class BackupEntity extends BaseEntity {
    /**
     * The name of the backup. Should be unique.
     */
    @Property.string({ default: defaultName, unique: true })
    name!: string;
    /**
     * The timestamp at which the backup has been created.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;
    /**
     * The resources that have been backed up.
     */
    @Property.oneToMany({ target: () => BackupResourceEntity, inverseSide: 'backup' })
    resources!: BackupResourceEntity[];
}

/**
 * The data required to create a new Backup Entity.
 */
export type BackupEntityCreateData = OmitStrict<BackupEntity, 'createdAt' | 'id' | 'resources' | 'name'>
    & Partial<Pick<BackupEntity, 'name'>>
    & {
        /**
         * The resources that have been backed up.
         */
        resources: BackupResourceEntityCreateData[]
    };

// eslint-disable-next-line jsdoc/require-jsdoc
function defaultName(): string {
    const format: FormatDateFn = inject(ZIBRI_DI_TOKENS.FORMAT_DATE);
    return format(new Date(), true);
}