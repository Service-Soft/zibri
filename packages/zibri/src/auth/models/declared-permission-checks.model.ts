import { HasPermissionMetadata, SkipHasPermissionMetadata } from './has-permission-metadata.model';
import { type Permission } from '../roles/permission.type';
import { type PlatformPermission } from '../roles/platform-permission.type';

/**
 * What a route and its controller declare about one kind of permission check.
 */
export type DeclaredPermissionChecks<PermissionType extends Permission | PlatformPermission> = {
    /**
     * The check on the controller, if any.
     */
    controller: HasPermissionMetadata<PermissionType> | undefined,
    /**
     * The check on the route, if any.
     */
    route: HasPermissionMetadata<PermissionType> | undefined,
    /**
     * The skip of the check on the controller, if any.
     */
    controllerSkip: SkipHasPermissionMetadata | undefined,
    /**
     * The skip of the check on the route, if any.
     */
    routeSkip: SkipHasPermissionMetadata | undefined
};