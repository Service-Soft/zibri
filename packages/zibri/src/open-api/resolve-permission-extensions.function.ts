import { type ResolvedAuthMetadata } from '../auth/models/resolved-auth-metadata.model';
import { OpenApiOperation } from './open-api.model';

/**
 * The fields of an operation of the OpenAPI or the AsyncAPI document naming the permissions its route asks for.
 * @param metadata - What the route resolved to.
 * @returns `x-permission` and `x-platform-permission`, and `x-any-level-permission` when either of them is enough.
 */
export function resolvePermissionExtensions(
    metadata: Partial<ResolvedAuthMetadata>
): Pick<OpenApiOperation, 'x-permission' | 'x-platform-permission' | 'x-any-level-permission'> {
    // a route never asks for any level's permission beside a permission of one level, which it is refused for while
    // it registers, so each field names one permission only
    return {
        'x-permission': metadata.hasPermission?.permission ?? metadata.hasAnyLevelPermission?.permission,
        'x-platform-permission': metadata.hasPlatformPermission?.permission ?? metadata.hasAnyLevelPermission?.platformPermission,
        'x-any-level-permission': metadata.hasAnyLevelPermission == undefined ? undefined : true
    };
}