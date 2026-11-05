import { BACKUP_FORMAT_VERSION } from './backup-format';
import { BackupResourceEntity, BackupResourceEntityCreateData } from './backup-resource-entity.model';
import { BackupStatus } from './backup-status.enum';
import { MasterKeyReference } from '../auth/encryption/master-key-reference.model';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { LocalizeServiceInterface } from '../localization/localize-service.interface';
import { LocaleCode } from '../localization/models/locale-code.model';
import { OmitStrict } from '../types/omit-strict.type';
import { type SemVerVersion } from '../utilities/sem-ver.utilities';
import { zibriVersion } from '../versioning/zibri-version.function';

/**
 * The entity of a single backup.
 */
// not backed up: the record of which backups exist belongs to the deployment taking them. Restored,
// it forgot every backup taken since, and brought back one still running when the data was read,
// which the queue then stored again over the archive of the backup that had completed
@Entity({ tenant: 'shared', allowOrphan: true, backedUp: false, defaultRelations: { resources: true } })
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
    // a function rather than the constant, for the reason zibriVersion below is one: a constant
    // becomes the column's default, and adding the column to a table of older backups then labels
    // every one of them as written in the shape this build reads - the one wrong guess the format
    // exists to refuse
    @Property.number({ format: 'integer', default: () => BACKUP_FORMAT_VERSION })
    formatVersion!: number;
    // written by a function rather than declared as a column default, so the version a row carries is
    // the one that wrote the row and not the one that created the table
    /**
     * The version of the framework that took this backup, which a later version reads to decide
     * whether it can restore the archive at all.
     */
    @Property.string({ default: zibriVersion })
    zibriVersion!: SemVerVersion;
    /**
     * The master keys a restore of this backup needs: the one its encrypted resources' keys were
     * encrypted with, and every one a data key it holds was encrypted under.
     */
    @Property.array({ items: { type: 'object', cls: () => MasterKeyReference } })
    masterKeys!: MasterKeyReference[];
    /**
     * The ids of the data keys that have to still exist when this backup is restored.
     *
     * Empty for a backup holding the data source the data keys are stored in, since restoring it
     * brings back the ones it needs. Otherwise every data key that existed when it was taken.
     */
    @Property.array({ items: { type: 'string' } })
    dataKeyIds!: string[];
    /**
     * Where the backup stands: its resources being stored, every one stored, or one given up on.
     */
    // COMPLETED by default for the records the transports hold, which are written once a backup is
    // complete, including those written before backups had a status
    @Property.string({ enum: BackupStatus, default: BackupStatus.COMPLETED })
    status!: BackupStatus;
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