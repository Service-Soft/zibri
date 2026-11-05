import { BackupEntity } from './backup-entity.model';
import { InternalError } from '../error-handling/internal-error.model';
import { FsPath } from '../utilities/fs.utilities';

/**
 * A resource a failed restore could not put back, and where what it held is kept.
 */
export type NotUndoneResource = {
    /**
     * The name of the resource, as the backup records it.
     */
    name: string,
    /**
     * Where what the resource held before the restore is kept.
     */
    snapshotPath: FsPath
};

/**
 * An error for a restore that failed and could not put every resource back the way it was.
 */
export class RestoreNotUndoneError extends InternalError {
    /**
     * Where what the resources that could not be put back held before the restore is kept.
     */
    readonly snapshotPaths: FsPath[];

    constructor(backup: BackupEntity, resources: NotUndoneResource[], cause: unknown) {
        const resourceNames: string = resources.map(r => `"${r.name}"`).join(', ');
        super(
            [
                `Restoring backup "${backup.name}" failed, and ${resourceNames}`
                + ' could not be put back the way they were.',
                ...resources.map(r => `What "${r.name}" held before the restore is kept in ${r.snapshotPath}.`)
            ],
            { cause }
        );
        this.name = 'RestoreNotUndoneError';
        this.snapshotPaths = resources.map(r => r.snapshotPath);
    }
}