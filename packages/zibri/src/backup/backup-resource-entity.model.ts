import { BackupEntity } from './backup-entity.model';
import { type EncryptionString } from '../auth/encryption/encryption.utilities';
import { FrameworkColumnRegistry } from '../data-source/migration/framework-column.registry';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { QueuedWorkEntity } from '../queue/queued-work-entity.model';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * A single resource entity: one resource of a backup, stored by whichever instance claims it. Its
 * `attempts` count the stores that failed, `nextAttemptAt` says when the next is due, and `error`
 * holds what the last one failed with.
 */
// not backed up, for the reason BackupEntity gives
@Entity({ tenant: 'shared', allowOrphan: true, backedUp: false })
export class BackupResourceEntity extends QueuedWorkEntity {
    /**
     * The name of the resource.
     */
    @Property.string()
    name!: string;
    /**
     * The size of the resource in bytes, as every transport received it.
     */
    @Property.number({ format: 'integer', required: false })
    size: number | undefined | null;
    /**
     * The bytes the data took on the disk of the instance that stored it, compressed as a restore stages
     * it, which says how much room restoring it takes. Null for a backup that recorded none, whose `size`
     * is all that is known of it.
     */
    @Property.number({ format: 'integer', required: false })
    stagedSize: number | undefined | null;
    /**
     * The sha256 of the data, as every transport received it.
     *
     * What a restore checks its copy against: an archive that has been truncated or damaged where it
     * is stored reads back as valid in every other respect, since a backup is opaque bytes and its
     * own name says nothing about what is inside it.
     */
    @Property.string({ required: false })
    checksum: string | undefined | null;
    /**
     * The key the data is encrypted with, itself encrypted with the master key, or null when the data
     * is stored unencrypted.
     *
     * A restore needs the master key it names, so a master key has to stay among the old master keys
     * for as long as backups taken under it are kept.
     */
    @Property.string({ required: false })
    encryptedKey: EncryptionString | undefined | null;
    /**
     * Whether every transport took the whole resource.
     */
    @Property.boolean({ default: false })
    completed!: boolean;
    /**
     * The names of the transports that have been used.
     */
    @Property.array({ items: { type: 'string' } })
    transportNames!: string[];
    /**
     * The backup whose data of this resource this one holds the changes since, or null when it holds the
     * resource's data in full.
     */
    @Property.string({ format: 'uuid', required: false })
    baseBackupId: string | undefined | null;
    /**
     * Where the resource reads on from once this backup completed, as the resource wrote it, or null for a
     * resource that always reads in full.
     */
    @Property.string({ required: false })
    readCursor: string | undefined | null;
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

FrameworkColumnRegistry.register(
    { entity: BackupResourceEntity, property: 'stagedSize' },
    { entity: BackupResourceEntity, property: 'baseBackupId' },
    { entity: BackupResourceEntity, property: 'readCursor' }
);

/**
 * The data required to create a new backup resource.
 */
export type BackupResourceEntityCreateData = OmitStrict<
    BackupResourceEntity,
    'id' | 'completed' | 'backup' | 'backupId' | 'size' | 'stagedSize' | 'checksum' | 'encryptedKey' | 'attempts' | 'nextAttemptAt'
    | 'error' | 'baseBackupId' | 'readCursor'
>;