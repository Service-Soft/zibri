
import { BackupResourceMetadata, BackupResourceMetadataInput } from './backup-resource-metadata.model';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { DiVariants } from '../../di/models/di-variant.model';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { BackupResourceInterface } from '../backup-resource.interface';

/**
 * Marks a resource that should be backed up. Needs to implement "BackupResourceInterface".
 * @param metadata - The metadata to set.
 */
export function Backup<T>(metadata: BackupResourceMetadataInput<T>): ClassDecorator {
    return target => {
        Injectable({ ...metadata, variant: DiVariants.BACKUP_RESOURCE })(target);
        const m: BackupResourceMetadata = {
            name: target.name,
            ...metadata
        };
        MetadataUtilities.setBackupResourceMetadata(target as unknown as Newable<BackupResourceInterface>, m);
    };
}