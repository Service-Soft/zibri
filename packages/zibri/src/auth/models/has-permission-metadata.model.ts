import { SkipMetadata } from './skip-auth-metadata.model';
import { type Permission } from '../roles/permission.type';
import { type PlatformPermission } from '../roles/platform-permission.type';
import { AuthStrategies } from '../strategies/auth-strategies.model';

/**
 * Metadata for the \@Auth.hasPermission and \@Auth.hasPlatformPermission decorators.
 */
export type HasPermissionMetadata<PermissionType extends Permission | PlatformPermission = Permission | PlatformPermission> = {
    /**
     * The permission the user needs to access the endpoint.
     */
    permission: PermissionType,
    /**
     * The strategies that are allowed for checking whether or not the user has the permission.
     *
     * If not set, this allows any strategy.
     */
    allowedStrategies?: AuthStrategies
};

/**
 * Metadata for the \@Auth.hasPermission.skip and \@Auth.hasPlatformPermission.skip decorators.
 */
export type SkipHasPermissionMetadata = SkipMetadata;