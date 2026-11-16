import { BackupDataOptions } from '../../backup/backup-data-options.model';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { testFileFolder } from '../constants';

/**
 * Where this process's resources sort what they sort on the way, as they would in the backup's staging folder.
 */
const STAGING_FOLDER: FsPath = FsUtilities.getPath(testFileFolder, `backup-data-staging-${UUIDUtilities.generate()}`);

/**
 * What a test that asks a resource for its backup data directly hands it, as the backup service would.
 */
export abstract class BackupDataOptionsTestUtilities {
    /**
     * Options as a backup hands them over, with a staging folder of this process's own under the test output.
     * @param chunked - Whether the data is cut into chunks, as a backup of format 2 cuts it.
     * @returns The options.
     */
    static resolve(chunked: boolean = true): BackupDataOptions {
        return { chunked, stagingFolder: STAGING_FOLDER };
    }
}