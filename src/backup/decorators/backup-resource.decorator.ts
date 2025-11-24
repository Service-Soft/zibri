
import { DiToken } from '../../di';
import { GlobalRegistry } from '../../global';
import { Newable } from '../../types';
import { MetadataUtilities } from '../../utilities';
import { BackupResourceInterface } from '../backup-resource.interface';
import { BackupResourceMetadata, BackupResourceMetadataInput } from './backup-resource-metadata.model';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Marks a resource that should be backed up. Needs to implement "BackupResourceInterface".
 * @param metadata - The metadata to set.
 */
export function Backup(metadata: BackupResourceMetadataInput): ClassDecorator {
    return target => {
        const m: BackupResourceMetadata = {
            name: target.name,
            ...metadata
        };
        MetadataUtilities.setBackupResourceMetadata(target as unknown as Newable<BackupResourceInterface>, m);
        GlobalRegistry.injectables.push({
            token: target as unknown as DiToken<BackupResourceInterface>,
            useClass: target as unknown as Newable<BackupResourceInterface>
        });
        GlobalRegistry.backupResources.push(target as unknown as Newable<BackupResourceInterface>);
    };
}