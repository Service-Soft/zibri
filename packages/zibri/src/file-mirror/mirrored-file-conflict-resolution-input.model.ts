import { type MirroredFileConflictResolutionInputModel } from 'zibri-contract';

import { Property } from '../entity/decorators/property.decorator';
import { MirroredFileConflictResolution } from './mirrored-file-conflict-resolution.enum';

/**
 * What resolving the conflict of a mirrored file takes, as `POST /conflicts/:mirroredFileId/resolution` of the
 * `FileMirrorController` takes it.
 */
export class MirroredFileConflictResolutionInput implements MirroredFileConflictResolutionInputModel {
    /**
     * `OVERWRITE` to write the last version mirrored over what is in the folder, `STOP_MIRRORING` to no longer mirror
     * the file.
     */
    @Property.string({ enum: MirroredFileConflictResolution })
    resolution!: MirroredFileConflictResolution;
}
