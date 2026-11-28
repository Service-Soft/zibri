import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { type CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AlsUtilities } from '../../context/als.utilities';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { type EntityScopeContext } from '../../entity/models/entity-scope.model';
import { type CurrentMembership } from '../../tenancy/membership/current-membership.model';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';

/**
 * Resolves what a scope is told about the caller running right now.
 * @param entityClass - The entity being read or written.
 * @returns The context.
 */
export async function resolveEntityScopeContext(entityClass: Newable<BaseEntity>): Promise<EntityScopeContext> {
    const context: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.getCurrentRequestContext();
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    // memoized per request, so a handler that also takes @CurrentUser or sits behind an @Auth check
    // shares the single lookup those already did. Undefined outside a request entirely, which the
    // scope is told about rather than being refused on its behalf
    const currentUser: CurrentUser | undefined = context
        ? await authService.resolveCurrentUser(context, authService.strategies, false)
        : undefined;
    const currentMembership: CurrentMembership | undefined = context
        ? await authService.resolveCurrentMembership(context, authService.strategies, false)
        : undefined;
    const tenantService: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);

    return {
        currentUser,
        tenantId: tenantService.getActiveTenantId(),
        currentMembership,
        // the same answer the permissions of the user above hold, asked of the auth service so that a
        // permission nobody declared is warned about, as it is for a check from anywhere else
        hasPermission: async permission => context != undefined
            && await authService.hasPermission(context, authService.strategies, permission),
        hasPlatformPermission: async permission => context != undefined
            && await authService.hasPlatformPermission(context, authService.strategies, permission),
        // the two checks of the interface rather than its optional third, which an auth service of the
        // application's own may leave out: either of them is what the third answers
        hasAnyLevelPermission: async permissions => context != undefined
            && (await authService.hasPermission(context, authService.strategies, permissions.permission)
                || await authService.hasPlatformPermission(context, authService.strategies, permissions.platformPermission)),
        requestContext: context,
        entityClass
    };
}