import { DefinedPermissions, definePermissions } from './define-permissions.function';

/**
 * The tenant permissions the routes of the WebDAV connections of Zibri check, in the tenant a request acts in: listing
 * the connections of that tenant, and adding, changing and deleting them. Spread them into the tenant permissions of
 * the application.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_WEB_DAV_PERMISSIONS = ['web-dav-connections.read', 'web-dav-connections.manage'] as const;

/**
 * {@link ZIBRI_WEB_DAV_PERMISSIONS}, by name.
 */
export const ZibriWebDavPermissions: DefinedPermissions<typeof ZIBRI_WEB_DAV_PERMISSIONS> = definePermissions(ZIBRI_WEB_DAV_PERMISSIONS);
