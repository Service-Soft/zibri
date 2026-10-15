import { BackupEntity } from './backup-entity.model';
import { type EncryptionString } from '../auth/encryption/encryption.utilities';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * A single resource entity.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class BackupResourceEntity extends BaseEntity {
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
export type BackupResourceEntityCreateData = OmitStrict<
    BackupResourceEntity,
    'id' | 'completed' | 'backup' | 'backupId' | 'size' | 'checksum' | 'encryptedKey'
>;