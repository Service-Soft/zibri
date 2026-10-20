import { type AuthServiceInterface } from '../../auth/auth-service.interface.ts';
import { BaseUser } from '../../auth/models/base-user.model.ts';
import { AlsUtilities } from '../../context/als.utilities.ts';
import { HttpRequestContext } from '../../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { EntityMetadata } from '../../entity/decorators/entity.decorator.ts';
import { type DenyAll, type EntityScopeContext, isUnscoped, type RestrictedToScope, type Unscoped } from '../../entity/models/entity-scope.model.ts';
import { BaseMembership } from '../../tenancy/membership/base-membership.model.ts';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface.ts';
import { Newable } from '../../types/newable.type.ts';
import { Where } from '../models/where/where-filter.model.ts';

/**
 * Asks an entity's scope what the caller running right now may see.
 *
 * Undefined means the entity declares no scope, the call is exempt from it, or the scope decided not
 * to restrict this caller. Returning `denyAll` means no row can satisfy it.
 * @param entityClass - The entity being read or written.
 * @param metadata - Its entity metadata, which carries the declared scope.
 * @param unscoped - Which scopes this call asked to be exempt from.
 * @returns The filter to narrow the call by, or the note that nothing may be seen.
 * @throws Whatever the scope itself throws, which is how it refuses a caller outright.
 */
export async function resolveEntityScope<T extends BaseEntity>(
    entityClass: Newable<T>,
    metadata: EntityMetadata,
    unscoped: Unscoped | undefined
): Promise<Where<T> | DenyAll | undefined> {
    const restrictedTo: RestrictedToScope | undefined = metadata.scope?.restrictedTo;
    if (!restrictedTo || isUnscoped('restrictedTo', unscoped)) {
        return undefined;
    }

    const context: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.getCurrentRequestContext();
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    // memoized per request, so a handler that also takes @CurrentUser or sits behind an @Auth check
    // shares the single lookup those already did. Undefined outside a request entirely, which the
    // scope is told about rather than being refused on its behalf
    const currentUser: BaseUser<string> | undefined = context
        ? await authService.getCurrentUser(context, authService.strategies, false)
        : undefined;
    const currentMembership: BaseMembership<string> | undefined = context
        ? await authService.getCurrentMembership(context, authService.strategies, false)
        : undefined;
    const tenantService: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);

    const scopeContext: EntityScopeContext = {
        currentUser,
        tenantId: tenantService.getActiveTenantId(),
        currentMembership,
        requestContext: context,
        entityClass
    };
    const result: Where<T> | DenyAll | undefined = await restrictedTo(scopeContext) as Where<T> | DenyAll | undefined;

    return result;
}