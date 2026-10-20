
import { BackupResourceMetadata, BackupResourceMetadataInput } from './backup-resource-metadata.model.ts';
import { Injectable } from '../../di/decorators/injectable.decorator.ts';
import { DiVariants } from '../../di/models/di-variant.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { BackupResourceInterface } from '../backup-resource.interface.ts';

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