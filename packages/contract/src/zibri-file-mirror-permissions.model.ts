import { DefinedPermissions, definePermissions } from './define-permissions.function';

/**
 * The tenant permissions the routes of the file mirror of Zibri check, in the tenant a request acts in: listing the
 * mirrored files in conflict, and resolving a conflict, creating a share link and revoking one. Spread them into the
 * tenant permissions of the application.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_FILE_MIRROR_PERMISSIONS = ['file-mirror.read', 'file-mirror.manage'] as const;

/**
 * {@link ZIBRI_FILE_MIRROR_PERMISSIONS}, by name.
 */
export const ZibriFileMirrorPermissions: DefinedPermissions<typeof ZIBRI_FILE_MIRROR_PERMISSIONS>
    = definePermissions(ZIBRI_FILE_MIRROR_PERMISSIONS);