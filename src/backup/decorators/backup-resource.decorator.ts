
import { BackupResourceMetadata, BackupResourceMetadataInput } from './backup-resource-metadata.model';
import { DiToken } from '../../di/models/di-token.model';
import { GlobalRegistry } from '../../global/global-registry';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { BackupResourceInterface } from '../backup-resource.interface';

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