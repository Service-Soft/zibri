// every import here is type only, and has to stay that way. This module is reached from
// `@Entity`, which every entity file evaluates before anything else is up - a value import of the
// request context pulls in ZIBRI_DI_TOKENS and with it most of the framework, which is a cycle that
// leaves whatever loads inside it holding undefined
import { type BaseUser } from '../../auth/models/base-user.model.ts';
import { type HttpRequestContext } from '../../context/request/http-request.context.ts';
import { type WebsocketRequestContext } from '../../context/request/websocket-request.context.ts';
import { type Where } from '../../data-source/models/where/where-filter.model.ts';
import { type BaseMembership } from '../../tenancy/membership/base-membership.model.ts';
import { type Newable } from '../../types/newable.type.ts';
import { type BaseEntity } from '../base-entity.model.ts';

/**
 * What a scope returns to mean that this caller may see no rows at all.
 *
 * Distinct from refusing the request: a list answers empty and a single row answers not found, which
 * is what a caller who is simply outside the data should get. Throw from the scope instead when the
 * request itself is the problem - an anonymous caller of something that needs a user, say.
 */
export const denyAll: unique symbol = Symbol('denyAll');

/**
 * The type of {@link denyAll}.
 */
export type DenyAll = typeof denyAll;

/**
 * What a scope is told about the caller it is deciding for.
 */
export type EntityScopeContext = {
    /**
     * The requesting user, if there is one.
     *
     * Undefined for an anonymous request and for anything running outside a request at all - a cron
     * job, a migration, a startup task. The scope decides what that means rather than the framework,
     * which is the point of writing one: rows that are public to everybody and rows that belong to
     * somebody are the same question asked of different entities.
     */
    currentUser: BaseUser<string> | undefined,
    /**
     * The tenant the work acts in, if one is active.
     */
    tenantId: string | undefined,
    /**
     * The membership the requesting user acts through in that tenant, its roles narrowed to what the
     * credential of the request may use. Undefined without a logged in user or an active tenant.
     */
    currentMembership: BaseMembership<string> | undefined,
    /**
     * The request being handled, if there is one.
     */
    requestContext: HttpRequestContext | WebsocketRequestContext | undefined,
    /**
     * The entity being read or written, so one scope can be shared by several of them.
     */
    entityClass: Newable<BaseEntity>
};

/**
 * Restricts the rows of an entity to whatever the caller may see.
 *
 * Returning undefined applies no restriction, a filter restricts to the rows matching it, and
 * {@link denyAll} restricts to none of them.
 */
export type RestrictedToScope<T extends BaseEntity = BaseEntity> = (
    context: EntityScopeContext
) => Where<T> | DenyAll | undefined | Promise<Where<T> | DenyAll | undefined>;

/**
 * Marks a scope as one that named the entity it is for.
 *
 * Declared and never assigned, so it exists only in the types: the one value carrying it is the one
 * `scopeFor` returns, which is what makes going through it the only way to declare a scope.
 */
declare const declaredScope: unique symbol;

/**
 * A scope that has been typed against its entity.
 *
 * What `restrictedTo` holds, and unreachable without {@link scopeFor} - a bare function is not one
 * of these, so forgetting to name the entity is a compile error rather than a filter nothing checked.
 */
export type DeclaredScope = RestrictedToScope & {
    /**
     * Present in the type and in no value. See {@link declaredScope}.
     */
    readonly [declaredScope]: true
};

/**
 * Types a scope against the entity it is declared on.
 *
 * Naming the entity is what makes the filter checked - its columns, their value types and the
 * operators each one allows. Without it only the column names can be inferred, which lets a filter
 * that cannot hold compile and then fail at runtime inside a security restriction.
 * @param scope - The scope to type.
 * @returns The same scope, marked as typed.
 */
export function scopeFor<T extends BaseEntity>(scope: RestrictedToScope<T>): DeclaredScope {
    // the one cast that may produce a DeclaredScope. The mark says the entity was named, and this is
    // the only place that can know it was
    return scope as DeclaredScope;
}

/**
 * Every scope an entity can declare, and the configuration each one takes.
 *
 * The single place scopes are enumerated: an entry here is a name `unscoped` accepts and a key
 * \@Entity understands, both derived below.
 */
type EntityScopes = {
    /**
     * Restricts the rows to whatever the caller may see, decided per request.
     */
    restrictedTo: DeclaredScope
};

/**
 * The name of a scope an entity can declare.
 *
 * A closed union rather than a free string, which is what lets `unscoped` name one scope and still be
 * checked by the compiler.
 */
export type EntityScopeName = keyof EntityScopes;

/**
 * The scopes an entity declares.
 */
export type EntityScope = Partial<EntityScopes>;

/**
 * Which scopes a single repository call is exempt from.
 *
 * `true` skips every scope the entity declares, an array skips the named ones. Always deliberate and
 * easy to search for: it is the one place a restriction declared on the entity does not apply.
 */
export type Unscoped = boolean | EntityScopeName[];

/**
 * Whether a call asked for the given scope to be skipped.
 * @param name - The scope to check.
 * @param unscoped - What the call passed as `unscoped`.
 * @returns Whether the scope should not be applied.
 */
export function isUnscoped(name: EntityScopeName, unscoped: Unscoped | undefined): boolean {
    return typeof unscoped === 'boolean' ? unscoped : unscoped?.includes(name) === true;
}