import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { EntityMetadata } from '../../entity/decorators/entity.decorator';
import { denyAll, type DenyAll, type EntityScopeContext, isUnscoped, type RestrictedToScope, type Unscoped } from '../../entity/models/entity-scope.model';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { Where } from '../models/where/where-filter.model';
import { type RepositoryTransaction } from '../transaction/repository-transaction.type';
import { resolveEntityScopeContext } from './resolve-entity-scope-context.function';
import { ScopedWhere, ScopeWhereUtilities } from './scope-where.utilities';

/**
 * Asks an entity's scopes what the caller running right now may see: its own `restrictedTo`, and the rows shared with
 * the caller of an entity that is shareable or shared through a relation. Both apply.
 *
 * Undefined means the entity declares no scope, the call is exempt from it, or the scope decided not
 * to restrict this caller. Returning `denyAll` means no row can satisfy it.
 * @param entityClass - The entity being read or written.
 * @param metadata - Its entity metadata, which carries the declared scope.
 * @param unscoped - Which scopes this call asked to be exempt from.
 * @param transaction - The transaction of the call, which what is shared is read in.
 * @returns The filter to narrow the call by, or the note that nothing may be seen.
 * @throws Whatever the scope itself throws, which is how it refuses a caller outright.
 */
export async function resolveEntityScope<T extends BaseEntity>(
    entityClass: Newable<T>,
    metadata: EntityMetadata,
    unscoped: Unscoped | undefined,
    transaction: RepositoryTransaction | undefined
): Promise<Where<T> | DenyAll | undefined> {
    const restrictedTo: RestrictedToScope | undefined = isUnscoped('restrictedTo', unscoped) ? undefined : metadata.scope?.restrictedTo;
    // named by no scope of its own: what is shared is lifted with every scope at once, by `unscoped: true`
    const shared: boolean = (metadata.shareable != undefined || metadata.sharedThrough != undefined) && unscoped !== true;
    if (!restrictedTo && !shared) {
        return undefined;
    }
    const scopeContext: EntityScopeContext = await resolveEntityScopeContext(entityClass);
    // the scope's answer typed by the entity it was declared for, which `scopeFor` checked
    const own: Where<T> | DenyAll | undefined = restrictedTo ? await restrictedTo(scopeContext) as Where<T> | DenyAll | undefined : undefined;
    if (!shared || own === denyAll) {
        return own;
    }
    // a filter over the entity it was asked for, which the interface answers for any entity
    const sharedWhere: Where<T> | DenyAll | undefined = await inject(ZIBRI_DI_TOKENS.SHARE_SERVICE)
        .resolveRestriction(entityClass, scopeContext, transaction) as Where<T> | DenyAll | undefined;
    if (own == undefined || sharedWhere == undefined || sharedWhere === denyAll) {
        return sharedWhere ?? own;
    }
    const combined: ScopedWhere<T> = ScopeWhereUtilities.applyToWhere(own, sharedWhere, MetadataUtilities.getModelProperties(entityClass));
    return combined.matchesNothing ? denyAll : combined.where;
}
