import { type MirroredFileConflictResolution } from './mirrored-file-conflict-resolution.enum';

/**
 * What resolving the conflict of a mirrored file takes, as `POST /conflicts/:mirroredFileId/resolution` of the routes
 * of the file mirror takes it.
 */
export type MirroredFileConflictResolutionInputModel = {
    /**
     * Whether the last version mirrored replaces what is in the folder, or the file is no longer mirrored.
     */
    resolution: MirroredFileConflictResolution
};