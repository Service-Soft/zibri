import { FsPath } from '../utilities/fs.utilities';

/**
 * What a backup does with the data a resource hands over, which a resource can shape its data for.
 */
export type BackupDataOptions = {
    /**
     * Whether the data is cut into chunks, each compressed and stored once. Data the resource compresses
     * itself deduplicates poorly then, since a change anywhere changes every compressed byte after it, so a
     * resource leaves its own compression off. False when the data is stored in one piece, such as a
     * snapshot a restore takes of what it replaces.
     */
    chunked: boolean,
    /**
     * A folder on this instance's own disk the resource may write to while it produces its data, such as
     * to sort more than it holds at once. What a resource writes there it deletes once its data is read,
     * and none of it is readable without a key the resource holds.
     */
    stagingFolder: FsPath
};