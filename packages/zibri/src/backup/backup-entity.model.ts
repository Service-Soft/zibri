import { BACKUP_FORMAT_VERSION } from './backup-format';
import { BackupResourceEntity, BackupResourceEntityCreateData } from './backup-resource-entity.model';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { LocalizeServiceInterface } from '../localization/localize-service.interface';
import { LocaleCode } from '../localization/models/locale-code.model';
import { OmitStrict } from '../types/omit-strict.type';
import { type SemVerVersion } from '../versioning/sem-ver.utilities';
import { zibriVersion } from '../versioning/zibri-version.function';

/**
 * The entity of a single backup.
 */
@Entity({ allowOrphan: true, defaultRelations: { resources: true } })
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
     * What shape this backup was written in.
     *
     * The one field a restore reads before it trusts anything else about the record, so it stays
     * where it is and means what it means across every shape there will ever be. See
     * {@link BACKUP_FORMAT_VERSION} for what a shape covers and why it is not the framework's version.
     */
    @Property.number({ format: 'integer', default: BACKUP_FORMAT_VERSION })
    formatVersion!: number;
    /**
     * The version of the framework that took this backup.
     *
     * A backup outlives the releases either side of it, so what wrote one is part of what it is: it is
     * what lets a later version decide whether it can read an archive at all, rather than finding out
     * while restoring it.
     *
     * Written by a function rather than declared as a column default, so the version a row carries is
     * the one that wrote the row and not the one that created the table.
     */
    @Property.string({ default: zibriVersion })
    zibriVersion!: SemVerVersion;
    /**
     * The resources that have been backed up.
     */
    @Property.oneToMany({ target: () => BackupResourceEntity, inverseSide: 'backup' })
    resources!: BackupResourceEntity[];
}

/**
 * The keys a backup gives itself, so that creating one names none of them.
 */
type GeneratedBackupKeys = 'createdAt' | 'id' | 'resources' | 'name' | 'zibriVersion' | 'formatVersion';

/**
 * The data required to create a new Backup Entity.
 */
export type BackupEntityCreateData = OmitStrict<BackupEntity, GeneratedBackupKeys>
    & Partial<Pick<BackupEntity, 'name'>>
    & {
        /**
         * The resources that have been backed up.
         */
        resources: BackupResourceEntityCreateData[]
    };

// eslint-disable-next-line jsdoc/require-jsdoc
function defaultName(): string {
    const localizeService: LocalizeServiceInterface = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE);
    const locale: LocaleCode = inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).defaultLocale;
    return localizeService.formatDate(new Date(), 'YYYY-MM-DD HH:mm', { locale });
}