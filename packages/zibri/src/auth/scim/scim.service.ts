import { BaseScimProvisioner } from './base-scim-provisioner.ts';
import { ScimBody } from './scim-body.model.ts';
import { isScimControllerClass } from './scim-controller.model.ts';
import { ScimEndpoint } from './scim-endpoint.model.ts';
import { ScimErrorType } from './scim-error-type.enum.ts';
import { ScimFilterMatch } from './scim-filter-match.model.ts';
import { ScimFilter } from './scim-filter.model.ts';
import { ScimFilterUtilities } from './scim-filter.utilities.ts';
import { ScimGroupMember } from './scim-group-member.model.ts';
import { ScimGroupResource } from './scim-group-resource.model.ts';
import { ScimGroup } from './scim-group.model.ts';
import { ScimIndexedFilter } from './scim-indexed-filter.model.ts';
import { ScimListQuery } from './scim-list-query.model.ts';
import { ScimMemberType } from './scim-member-type.enum.ts';
import { ScimPatchOperation } from './scim-patch-operation.model.ts';
import { ScimPatchUtilities } from './scim-patch.utilities.ts';
import { ScimProvisionerClass } from './scim-provisioner-class.type.ts';
import { ScimResourceResponse } from './scim-resource-response.model.ts';
import { ScimSchema } from './scim-schema.enum.ts';
import { ScimSchemaUtilities } from './scim-schema.utilities.ts';
import { ScimServiceInterface } from './scim-service.interface.ts';
import { ScimUserResource } from './scim-user-resource.model.ts';
import { ScimUserValue } from './scim-user-value.model.ts';
import { ScimUserValueUtilities } from './scim-user-value.utilities.ts';
import { ScimUser } from './scim-user.model.ts';
import { ScimValueSort } from './scim-value-sort.model.ts';
import { ScimWhereUtilities } from './scim-where.utilities.ts';
import { ScimError } from './scim.error.ts';
import { ZibriApplication } from '../../application/application.ts';
import { Where, WhereFilter } from '../../data-source/models/where/where-filter.model.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { ScopedWhere, ScopeWhereUtilities } from '../../data-source/scopes/scope-where.utilities.ts';
import { Transaction } from '../../data-source/transaction/transaction.model.ts';
import { UniqueConstraintViolationError } from '../../data-source/unique-constraint-violation.error.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { Injectable } from '../../di/decorators/injectable.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { register } from '../../di/register.function.ts';
import { EntityOrder } from '../../entity/models/entity-order.model.ts';
import { ConflictError } from '../../error-handling/errors/conflict.error.ts';
import { HttpError } from '../../error-handling/errors/http.error.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { OnAppInit } from '../../global/on-app-init.interface.ts';
import { HttpStatus } from '../../http/http-status.enum.ts';
import { $ts } from '../../localization/translate.function.ts';
import { AuditAction, AuditOutcome } from '../../logging/audit-event.model.ts';
import { auditReasonFor } from '../../logging/audit-reason-for.function.ts';
import { type LoggerInterface } from '../../logging/logger.interface.ts';
import { BaseMembership } from '../../tenancy/membership/base-membership.model.ts';
import { type MembershipServiceInterface } from '../../tenancy/membership/membership-service.interface.ts';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { PromiseUtilities } from '../../utilities/promise.utilities.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function.ts';
import { type AuthServiceInterface } from '../auth-service.interface.ts';
import { BaseUser } from '../models/base-user.model.ts';
import { ApiKeyAuthStrategy } from '../strategies/api-key/api-key.auth-strategy.ts';
import { type UserServiceInterface } from '../user/user-service.interface.ts';

/**
 * The most resources a list answers with.
 */
const MAX_RESULTS: number = 200;

/**
 * How an identity provider authenticates, as the ServiceProviderConfig says it.
 */
const BEARER_TOKEN_SCHEME: ScimBody = {
    type: 'oauthbearertoken',
    name: 'Bearer token',
    description: 'An api key, sent as a bearer token',
    primary: true
};

/**
 * The attributes of a user that are kept in columns of their own, never kept, or read from their
 * memberships, in lower case.
 */
const RESERVED_USER_ATTRIBUTES: string[] = ['id', 'meta', 'schemas', 'username', 'externalid', 'active', 'password', 'groups'];

/**
 * What a request for a whole resource asks for: every attribute.
 */
const EVERY_ATTRIBUTE: Pick<ScimListQuery, 'attributes' | 'excludedAttributes'> = { attributes: undefined, excludedAttributes: undefined };

/**
 * The methods an operation of a bulk request may have.
 */
const BULK_METHODS: string[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * What a reference to a resource another operation of the same bulk request creates starts with.
 */
const BULK_ID_PREFIX: string = 'bulkId:';

/**
 * A user as a request provisions it, before it has an id.
 */
type ScimUserInput = OmitStrict<ScimUserResource, 'id'>;

/**
 * A group as a request provisions it, before it has an id.
 */
type ScimGroupInput = OmitStrict<ScimGroupResource, 'id'> & {
    /**
     * The ids of the SCIM resources of its members, users and groups.
     */
    memberIds: string[]
};

/**
 * A member of a group, and what it is.
 */
type ScimMember = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    id: string,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    type: ScimMemberType
};

/**
 * An operation of a bulk request (RFC 7644, 3.7), read.
 */
type ScimBulkOperation = {
    /**
     * Its position in the request.
     */
    index: number,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    method: string,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    bulkId: string | undefined,
    /**
     * The etag the resource has to have, if the operation names one.
     */
    version: string | undefined,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    path: string,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    data: unknown
};

/**
 * A bulk request as it is applied.
 */
type ScimBulkRun = {
    /**
     * The routes the request came through.
     */
    endpoint: ScimEndpoint,
    /**
     * After how many failed operations it stops, if it stops at all.
     */
    failOnErrors: number | undefined,
    /**
     * The id of every resource an operation created, by the bulkId it named.
     */
    created: Map<string, string>,
    /**
     * The result of every operation applied, by its position in the request.
     */
    results: Map<number, ScimBody>,
    /**
     * How many operations failed so far.
     */
    errors: number
};

/**
 * A group a user is a member of, and whether directly or through another group.
 */
type ScimUserGroup = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    group: ScimGroup,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    direct: boolean
};

/**
 * What a change answers with, and the user it was about, for the audit trail.
 */
type AuditedResult<T> = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    result: T,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    userId: string | undefined
};

/**
 * Default SCIM service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class ScimService implements ScimServiceInterface, OnAppInit {
    // read when used rather than injected, so that an application without SCIM is not asked for the entities
    private get users(): Repository<ScimUser> {
        return inject(repositoryTokenFor(ScimUser));
    }

    private get groups(): Repository<ScimGroup> {
        return inject(repositoryTokenFor(ScimGroup));
    }

    private get members(): Repository<ScimGroupMember> {
        return inject(repositoryTokenFor(ScimGroupMember));
    }

    private get values(): Repository<ScimUserValue> {
        return inject(repositoryTokenFor(ScimUserValue));
    }

    private get authService(): AuthServiceInterface {
        return inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    }

    private get userService(): UserServiceInterface {
        return inject(ZIBRI_DI_TOKENS.USER_SERVICE);
    }

    private get membershipService(): MembershipServiceInterface {
        return inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE);
    }

    private get tenantService(): TenantServiceInterface {
        return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        const provisioners: ScimProvisionerClass[] = app.options.controllers
            .filter(controller => isScimControllerClass(controller))
            .map(controller => controller.scimProvisioner);
        if (!provisioners.length) {
            return;
        }
        validateEntitiesRegistered(ScimService.name, app, ScimUser, ScimUserValue, ScimGroup, ScimGroupMember);
        for (const provisioner of provisioners) {
            register({ token: provisioner, useClass: provisioner });
        }
        // identity providers authenticate with a token they send as a bearer token, which an api key is
        if (!app.options.authStrategies.some(s => s === ApiKeyAuthStrategy || s.prototype instanceof ApiKeyAuthStrategy)) {
            throw new InternalError('SCIM needs ApiKeyAuthStrategy among the authStrategies of the application.');
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    getServiceProviderConfig(endpoint: ScimEndpoint): ScimBody {
        return {
            schemas: [ScimSchema.SERVICE_PROVIDER_CONFIG],
            patch: { supported: true },
            bulk: { supported: true, maxOperations: endpoint.maxBulkOperations, maxPayloadSize: endpoint.maxBulkPayloadSize },
            filter: { supported: true, maxResults: MAX_RESULTS },
            changePassword: { supported: false },
            sort: { supported: true },
            etag: { supported: true },
            authenticationSchemes: [BEARER_TOKEN_SCHEME],
            meta: { resourceType: 'ServiceProviderConfig', location: `${endpoint.url}/ServiceProviderConfig` }
        };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    getResourceTypes(endpoint: ScimEndpoint): ScimBody {
        const resources: ScimBody[] = this.resolveResourceTypes(endpoint);
        return this.toListBody(resources, resources.length, 1);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    findResourceType(endpoint: ScimEndpoint, id: string): ScimBody {
        const resource: ScimBody | undefined = this.resolveResourceTypes(endpoint).find(r => r['id'] === id);
        if (resource == undefined) {
            throw new ScimError(HttpStatus.NOT_FOUND, $ts`There is no resource type ${id}.`);
        }
        return resource;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    getSchemas(endpoint: ScimEndpoint): ScimBody {
        const schemas: ScimBody[] = ScimSchemaUtilities.getSchemas(endpoint.url);
        return this.toListBody(schemas, schemas.length, 1);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    findSchema(endpoint: ScimEndpoint, id: string): ScimBody {
        const schema: ScimBody | undefined = ScimSchemaUtilities.getSchemas(endpoint.url).find(s => s['id'] === id);
        if (schema == undefined) {
            throw new ScimError(HttpStatus.NOT_FOUND, $ts`There is no schema ${id}.`);
        }
        return schema;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async createUser(endpoint: ScimEndpoint, body: unknown): Promise<ScimResourceResponse> {
        return await this.audited(AuditAction.SCIM_USER_CREATED, async () => {
            const input: ScimUserInput = this.resolveUserInput(body);
            // a name a resource whose user is gone still holds is free again
            await this.removeOrphanedHolder(input.userName);
            return await this.inTransaction(async transaction => {
                await this.validateUserNameFree(input.userName, undefined, transaction);
                const id: string = UUIDUtilities.generate();
                const provisioner: BaseScimProvisioner<string> = inject(endpoint.provisioner);
                const found: BaseUser<string> | undefined = await provisioner.findProvisionedUser({ id, ...input }, transaction);
                // only a user it creates is the tenant's own. One that existed already may belong to
                // other tenants too, and an identity provider claiming them by their email could
                // otherwise change that email and take their account over everywhere
                const user: BaseUser<string> = found ?? await provisioner.createProvisionedUser({ id, ...input }, transaction);
                const scimUser: ScimUser = await this.users.create(
                    {
                        id,
                        userId: user.id,
                        ownsUser: found == undefined,
                        userName: input.userName,
                        userNameKey: input.userName.toLowerCase(),
                        externalId: input.externalId,
                        active: input.active,
                        attributes: input.attributes
                    },
                    { transaction, allowId: true }
                );
                await this.values.createAll(ScimUserValueUtilities.toValues(id, input.attributes), { transaction });
                // before deactivating, which a membership has to exist for. Without groups: a resource
                // that did not exist cannot be a member of one yet
                const membership: BaseMembership<string> = await this.membershipService.resolveMembership(
                    user.id,
                    this.getActiveTenantId(),
                    transaction
                );
                await provisioner.resolveGroupMembership(membership, [], transaction);
                if (!input.active) {
                    await this.updateActive(scimUser, user, false, transaction);
                }
                return { result: await this.resolveUserResponse(endpoint, scimUser, EVERY_ATTRIBUTE, transaction), userId: user.id };
            });
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async findUser(
        endpoint: ScimEndpoint,
        id: string,
        query: Pick<ScimListQuery, 'attributes' | 'excludedAttributes'>
    ): Promise<ScimResourceResponse> {
        return await this.resolveUserResponse(endpoint, await this.findLiveUser(id), query, undefined);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async findUsers(endpoint: ScimEndpoint, query: ScimListQuery): Promise<ScimBody> {
        const filter: ScimFilter | undefined = query.filter == undefined ? undefined : ScimFilterUtilities.parse(query.filter);
        const where: WhereFilter<ScimUser>[] | undefined = filter == undefined
            ? undefined
            : ScimWhereUtilities.resolveUserWhere(filter, await this.resolveFilterMatches(filter));
        const order: EntityOrder<ScimUser> | ScimValueSort = query.sortBy == undefined
            ? { createdAt: 'ASC', id: 'ASC' }
            : ScimWhereUtilities.resolveUserOrder(query.sortBy, query.sortOrder);
        const startIndex: number = this.resolveStartIndex(query);
        if (where?.length === 0) {
            return this.toListBody([], 0, startIndex);
        }
        if ('paths' in order) {
            return await this.resolveValueSortedPage(endpoint, query, where, order);
        }
        return await this.resolveUserPage(endpoint, query, where, order);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async replaceUser(endpoint: ScimEndpoint, id: string, body: unknown, ifMatch: string | undefined): Promise<ScimResourceResponse> {
        return await this.audited(AuditAction.SCIM_USER_UPDATED, async () => {
            const input: ScimUserInput = this.resolveUserInput(body);
            await this.findLiveUser(id);
            return await this.inTransaction(async transaction => {
                const scimUser: ScimUser = await this.findScimUser(id, transaction);
                this.validateVersion(scimUser.version, ifMatch);
                return { result: await this.updateUser(endpoint, scimUser, input, ifMatch, transaction), userId: scimUser.userId };
            });
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async patchUser(endpoint: ScimEndpoint, id: string, body: unknown, ifMatch: string | undefined): Promise<ScimResourceResponse> {
        return await this.audited(AuditAction.SCIM_USER_UPDATED, async () => {
            const operations: ScimPatchOperation[] = ScimPatchUtilities.resolveOperations(body);
            await this.findLiveUser(id);
            return await this.inTransaction(async transaction => {
                const scimUser: ScimUser = await this.findScimUser(id, transaction);
                this.validateVersion(scimUser.version, ifMatch);
                const state: Record<string, unknown> = {
                    ...scimUser.attributes,
                    userName: scimUser.userName,
                    ...scimUser.externalId == undefined ? {} : { externalId: scimUser.externalId },
                    active: scimUser.active
                };
                const input: ScimUserInput = this.resolveUserInput(ScimPatchUtilities.apply(state, operations));
                return { result: await this.updateUser(endpoint, scimUser, input, ifMatch, transaction), userId: scimUser.userId };
            });
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async deleteUser(endpoint: ScimEndpoint, id: string, ifMatch: string | undefined): Promise<void> {
        await this.audited(AuditAction.SCIM_USER_DELETED, async () => {
            await this.findLiveUser(id);
            return await this.inTransaction(async transaction => {
                const scimUser: ScimUser = await this.findScimUser(id, transaction);
                this.validateVersion(scimUser.version, ifMatch);
                const user: BaseUser<string> | undefined = await this.findApplicationUser(scimUser);
                if (user != undefined) {
                    if (scimUser.ownsUser) {
                        // first, so that a hook keeping the user, anonymized say, keeps them unable to log in
                        if (user.deactivatedAt == undefined) {
                            await this.authService.deactivateUser(user.id, transaction);
                        }
                        await inject(endpoint.provisioner).resolveDeletedUser(user, transaction);
                    }
                    await this.membershipService.deleteMembership(user.id, this.getActiveTenantId(), transaction);
                }
                await this.removeMembers([scimUser.id], transaction);
                await this.values.deleteAll({ scimUserId: scimUser.id }, { transaction });
                this.validateDeleted(await this.users.deleteAll({ id: scimUser.id, version: scimUser.version }, { transaction }), ifMatch);
                return { result: undefined, userId: scimUser.userId };
            });
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async createGroup(endpoint: ScimEndpoint, body: unknown): Promise<ScimResourceResponse> {
        return await this.audited(AuditAction.SCIM_GROUP_CREATED, async () => {
            const input: ScimGroupInput = this.resolveGroupInput(body);
            return await this.inTransaction(async transaction => {
                const members: ScimMember[] = await this.resolveMembers(input.memberIds, transaction);
                const group: ScimGroup = await this.groups.create(
                    { displayName: input.displayName, displayNameKey: input.displayName.toLowerCase(), externalId: input.externalId },
                    { transaction }
                );
                await this.members.createAll(
                    members.map(member => ({ groupId: group.id, memberId: member.id, memberType: member.type })),
                    { transaction }
                );
                await this.applyGroupMembership(endpoint, await this.resolveUsersUnder([group.id], transaction), transaction);
                return { result: await this.toGroupResponse(endpoint, group, EVERY_ATTRIBUTE, transaction), userId: undefined };
            });
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async findGroup(
        endpoint: ScimEndpoint,
        id: string,
        query: Pick<ScimListQuery, 'attributes' | 'excludedAttributes'>
    ): Promise<ScimResourceResponse> {
        return await this.toGroupResponse(endpoint, await this.findScimGroup(id, undefined), query, undefined);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async findGroups(endpoint: ScimEndpoint, query: ScimListQuery): Promise<ScimBody> {
        const filter: ScimFilter | undefined = query.filter == undefined ? undefined : ScimFilterUtilities.parse(query.filter);
        const where: WhereFilter<ScimGroup>[] | undefined = filter == undefined
            ? undefined
            : ScimWhereUtilities.resolveGroupWhere(filter, await this.findGroupsOfMembers(ScimWhereUtilities.findMemberIds(filter)));
        const order: EntityOrder<ScimGroup> = query.sortBy == undefined
            ? { createdAt: 'ASC', id: 'ASC' }
            : ScimWhereUtilities.resolveGroupOrder(query.sortBy, query.sortOrder);
        const startIndex: number = this.resolveStartIndex(query);
        if (where?.length === 0) {
            return this.toListBody([], 0, startIndex);
        }
        const count: number = this.resolveCount(query);
        const totalResults: number = await this.groups.count({ where });
        const found: ScimGroup[] = count === 0 ? [] : await this.groups.findAll({ where, order, skip: startIndex - 1, take: count });
        const resources: ScimBody[] = await Promise.all(
            found.map(async group => (await this.toGroupResponse(endpoint, group, query, undefined)).body)
        );
        return this.toListBody(resources, totalResults, startIndex);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async replaceGroup(endpoint: ScimEndpoint, id: string, body: unknown, ifMatch: string | undefined): Promise<ScimResourceResponse> {
        return await this.audited(AuditAction.SCIM_GROUP_UPDATED, async () => {
            const input: ScimGroupInput = this.resolveGroupInput(body);
            return await this.inTransaction(async transaction => {
                const group: ScimGroup = await this.findScimGroup(id, transaction);
                this.validateVersion(group.version, ifMatch);
                const memberIds: string[] = await this.findMemberIds(group.id, transaction);
                return { result: await this.updateGroup(endpoint, group, memberIds, input, ifMatch, transaction), userId: undefined };
            });
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async patchGroup(endpoint: ScimEndpoint, id: string, body: unknown, ifMatch: string | undefined): Promise<ScimResourceResponse> {
        return await this.audited(AuditAction.SCIM_GROUP_UPDATED, async () => {
            const operations: ScimPatchOperation[] = ScimPatchUtilities.resolveOperations(body);
            return await this.inTransaction(async transaction => {
                const group: ScimGroup = await this.findScimGroup(id, transaction);
                this.validateVersion(group.version, ifMatch);
                const memberIds: string[] = await this.findMemberIds(group.id, transaction);
                const state: Record<string, unknown> = {
                    displayName: group.displayName,
                    ...group.externalId == undefined ? {} : { externalId: group.externalId },
                    members: memberIds.map(value => ({ value }))
                };
                const input: ScimGroupInput = this.resolveGroupInput(ScimPatchUtilities.apply(state, operations));
                return { result: await this.updateGroup(endpoint, group, memberIds, input, ifMatch, transaction), userId: undefined };
            });
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async deleteGroup(endpoint: ScimEndpoint, id: string, ifMatch: string | undefined): Promise<void> {
        await this.audited(AuditAction.SCIM_GROUP_DELETED, async () => await this.inTransaction(async transaction => {
            const group: ScimGroup = await this.findScimGroup(id, transaction);
            this.validateVersion(group.version, ifMatch);
            // read before its members go, since they are who loses the group
            const affected: string[] = await this.resolveUsersUnder([group.id], transaction);
            await this.members.deleteAll({ groupId: group.id }, { transaction });
            await this.removeMembers([group.id], transaction);
            this.validateDeleted(await this.groups.deleteAll({ id: group.id, version: group.version }, { transaction }), ifMatch);
            await this.applyGroupMembership(endpoint, affected, transaction);
            return { result: undefined, userId: undefined };
        }));
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async bulk(endpoint: ScimEndpoint, body: unknown): Promise<ScimBody> {
        const run: ScimBulkRun = {
            endpoint,
            failOnErrors: this.resolveFailOnErrors(body),
            created: new Map(),
            results: new Map(),
            errors: 0
        };
        let pending: ScimBulkOperation[] = this.resolveBulkOperations(endpoint, body);
        // operations creating a resource without what refers to the others of a circle, and its id
        const unfinished: [ScimBulkOperation, string][] = [];
        while (pending.length && !this.isBulkStopped(run)) {
            const deferred: ScimBulkOperation[] = await this.resolveBulkPass(run, pending);
            if (deferred.length < pending.length) {
                pending = deferred;
                continue;
            }
            // operations that only wait for each other refer to each other in a circle, which creating
            // one of them without its references first breaks
            const breaker: ScimBulkOperation | undefined = this.findBulkCircleBreaker(deferred);
            if (breaker == undefined) {
                for (const operation of deferred) {
                    run.results.set(operation.index, this.toBulkError(operation, new ScimError(
                        HttpStatus.CONFLICT,
                        $ts`The operation refers in a circle to resources the request creates.`
                    )));
                }
                break;
            }
            const id: string | undefined = await this.resolveBulkCircleBreak(run, breaker);
            if (id != undefined) {
                unfinished.push([breaker, id]);
            }
            pending = deferred.filter(operation => operation !== breaker);
        }
        // in order, each the rest of an operation already applied, and so even after a stop
        for (const [operation, id] of unfinished) {
            run.results.set(operation.index, await this.resolveBulkCompletion(run, operation, id));
        }
        return {
            schemas: [ScimSchema.BULK_RESPONSE],
            Operations: [...run.results.entries()].sort(([a], [b]) => a - b).map(([, result]) => result)
        };
    }

    /**
     * Applies the operations of a bulk request whose references can be resolved, in order.
     * @param run - The bulk request being applied.
     * @param pending - The operations not applied yet.
     * @returns The operations that wait for a resource one of the others creates.
     */
    private async resolveBulkPass(run: ScimBulkRun, pending: ScimBulkOperation[]): Promise<ScimBulkOperation[]> {
        const waiting: Set<string> = new Set(pending.map(operation => operation.bulkId).filter(bulkId => bulkId != undefined));
        const deferred: ScimBulkOperation[] = [];
        for (const operation of pending) {
            if (this.isBulkStopped(run)) {
                break;
            }
            const unresolved: string[] = this.findBulkReferences(operation).filter(bulkId => !run.created.has(bulkId));
            // one created by an operation further on: this one waits for it
            if (unresolved.some(bulkId => waiting.has(bulkId) && bulkId !== operation.bulkId)) {
                deferred.push(operation);
                continue;
            }
            const result: ScimBody = unresolved.length
                ? this.toBulkError(operation, new ScimError(
                    HttpStatus.CONFLICT,
                    $ts`The operation refers to bulkId ${unresolved.join(', ')}, which no operation of the request created.`
                ))
                : await this.resolveBulkResult(run.endpoint, operation, run.created);
            run.errors += this.isBulkError(result) ? 1 : 0;
            run.results.set(operation.index, result);
        }
        return deferred;
    }

    /**
     * The operation of a circle to break: one creating a resource another of the circle refers to.
     * @param deferred - The operations of the circle, and those waiting for them.
     * @returns The operation, or undefined when none creates what the others wait for.
     */
    private findBulkCircleBreaker(deferred: ScimBulkOperation[]): ScimBulkOperation | undefined {
        const referenced: Set<string> = new Set(deferred.flatMap(operation => this.findBulkReferences(operation)));
        return deferred.find(operation => operation.method === 'POST' && operation.bulkId != undefined && referenced.has(operation.bulkId));
    }

    /**
     * Creates the resource of an operation of a circle without what refers to the resources the
     * others create, so that they can be applied.
     * @param run - The bulk request being applied.
     * @param operation - The operation.
     * @returns The id of the resource, or undefined when it could not be created.
     */
    private async resolveBulkCircleBreak(run: ScimBulkRun, operation: ScimBulkOperation): Promise<string | undefined> {
        const unresolved: Set<string> = new Set(this.findBulkReferences(operation).filter(bulkId => !run.created.has(bulkId)));
        const result: ScimBody = await this.resolveBulkResult(
            run.endpoint,
            { ...operation, data: this.withoutBulkReferences(operation.data, unresolved) },
            run.created
        );
        run.errors += this.isBulkError(result) ? 1 : 0;
        run.results.set(operation.index, result);
        return operation.bulkId == undefined ? undefined : run.created.get(operation.bulkId);
    }

    /**
     * Replaces the resource an operation of a circle created with the whole of its data, now that the
     * resources it refers to exist.
     * @param run - The bulk request being applied.
     * @param operation - The operation.
     * @param id - The id of the resource it created.
     * @returns The result of the operation.
     */
    private async resolveBulkCompletion(run: ScimBulkRun, operation: ScimBulkOperation, id: string): Promise<ScimBody> {
        const users: boolean = operation.path === '/Users';
        const unresolved: string[] = this.findBulkReferences(operation).filter(bulkId => !run.created.has(bulkId));
        try {
            if (unresolved.length) {
                throw new ScimError(
                    HttpStatus.CONFLICT,
                    $ts`The operation refers to bulkId ${unresolved.join(', ')}, which no operation of the request created.`
                );
            }
            const data: unknown = this.replaceBulkIds(operation.data, run.created);
            const response: ScimResourceResponse = await this.resolveBulkChange(run.endpoint, 'PUT', users, id, data, undefined);
            return this.toBulkResult(operation, response.location, response.version, HttpStatus.CREATED);
        }
        catch (error) {
            // the resource exists, without what referred to the others
            return { ...this.toBulkError(operation, error), location: `${run.endpoint.url}${operation.path}/${id}` };
        }
    }

    /**
     * Finds the users each part of a filter that compares an attribute without a column of its own
     * holds for.
     * @param filter - The filter.
     * @returns The users, by the part.
     */
    private async resolveFilterMatches(filter: ScimFilter): Promise<Map<ScimFilter, ScimFilterMatch>> {
        return new Map(await Promise.all(ScimWhereUtilities.findIndexedFilters(filter).map(
            async (part): Promise<[ScimFilter, ScimFilterMatch]> => [part.filter, await this.resolveFilterMatch(part)]
        )));
    }

    private async resolveFilterMatch(part: ScimIndexedFilter): Promise<ScimFilterMatch> {
        const { filter, key } = part;
        if (ScimWhereUtilities.isGroupsKey(key)) {
            return await this.resolveGroupsMatch(filter);
        }
        switch (filter.type) {
            case 'comparison': {
                // a comparison of an attribute that names no sub-attribute compares the value of a complex one
                const paths: string[] = filter.path.subAttribute == undefined ? [key, `${key}.value`] : [key];
                if (filter.value === null) {
                    // a comparison with null asks whether there is a value at all
                    if (filter.operator !== 'eq' && filter.operator !== 'ne') {
                        throw ScimWhereUtilities.unsupportedFilter();
                    }
                    const holders: string[] = await this.findValueHolders(this.toPresentWhere(key, filter.path.subAttribute));
                    return { ids: holders, negated: filter.operator === 'eq' };
                }
                const where: WhereFilter<ScimUserValue>[] = ScimWhereUtilities.resolveValueWhere(paths, filter.operator, filter.value);
                return { ids: await this.findValueHolders(where), negated: filter.operator === 'ne' };
            }
            case 'present': {
                return { ids: await this.findValueHolders(this.toPresentWhere(key, filter.path.subAttribute)), negated: false };
            }
            case 'valuePath': {
                let all: Promise<Set<string>> | undefined;
                const universe: () => Promise<Set<string>> = async () => await (all ??= this.findElements({ attribute: key }));
                const elements: Set<string> = await this.resolveElements(filter.filter, key, universe);
                return { ids: [...new Set([...elements].map(element => element.slice(0, element.indexOf('#'))))], negated: false };
            }
        }
    }

    /**
     * The values of a multi-valued attribute the filter of a value path holds for, so that its
     * comparisons hold for one value together: `emails[type eq "work" and value co "@corp"]`.
     * @param filter - The filter of the value path.
     * @param attribute - The attribute, in lower case.
     * @param universe - Every value of the attribute.
     * @returns The values, each as the id of the user and its position: `{id}#{position}`.
     */
    private async resolveElements(filter: ScimFilter, attribute: string, universe: () => Promise<Set<string>>): Promise<Set<string>> {
        switch (filter.type) {
            case 'and':
            case 'or': {
                const [left, right] = await Promise.all([
                    this.resolveElements(filter.left, attribute, universe),
                    this.resolveElements(filter.right, attribute, universe)
                ]);
                return filter.type === 'and' ? new Set([...left].filter(element => right.has(element))) : new Set([...left, ...right]);
            }
            case 'not': {
                return this.withoutElements(await universe(), await this.resolveElements(filter.filter, attribute, universe));
            }
            case 'valuePath': {
                // a value path inside one, which the grammar of a filter does not allow
                throw ScimWhereUtilities.unsupportedFilter();
            }
            case 'present': {
                return await this.findElements({ path: ScimWhereUtilities.toPathKey(filter.path, `${attribute}.`) });
            }
            case 'comparison': {
                const path: string = ScimWhereUtilities.toPathKey(filter.path, `${attribute}.`);
                if (filter.value === null) {
                    if (filter.operator !== 'eq' && filter.operator !== 'ne') {
                        throw ScimWhereUtilities.unsupportedFilter();
                    }
                    const present: Set<string> = await this.findElements({ path });
                    return filter.operator === 'eq' ? this.withoutElements(await universe(), present) : present;
                }
                const where: WhereFilter<ScimUserValue>[] = ScimWhereUtilities.resolveValueWhere([path], filter.operator, filter.value);
                const found: Set<string> = await this.findElements(where);
                return filter.operator === 'ne' ? this.withoutElements(await universe(), found) : found;
            }
        }
    }

    private async findElements(where: Where<ScimUserValue>): Promise<Set<string>> {
        const values: ScimUserValue[] = await this.values.findAll({ where, take: 'all' });
        return new Set(values.map(value => `${value.scimUserId}#${value.element}`));
    }

    private withoutElements(all: Set<string>, left: Set<string>): Set<string> {
        return new Set([...all].filter(element => !left.has(element)));
    }

    /**
     * The users a part of a filter on the groups of users holds for: those in a group it holds for,
     * directly or through other groups.
     * @param filter - The part.
     * @returns The users.
     */
    private async resolveGroupsMatch(filter: ScimIndexedFilter['filter']): Promise<ScimFilterMatch> {
        let groupFilter: ScimFilter = filter;
        let negated: boolean = false;
        if (filter.type === 'comparison' && filter.value === null) {
            // a comparison with null asks whether the user is in a group at all
            if (filter.operator !== 'eq' && filter.operator !== 'ne') {
                throw ScimWhereUtilities.unsupportedFilter();
            }
            groupFilter = { type: 'present', path: filter.path };
            negated = filter.operator === 'eq';
        }
        const where: WhereFilter<ScimGroup>[] = ScimWhereUtilities.resolveGroupWhere(
            ScimWhereUtilities.toGroupFilter(groupFilter),
            new Map()
        );
        const groups: ScimGroup[] = where.length ? await this.groups.findAll({ where, take: 'all' }) : [];
        return { ids: await this.resolveUsersUnder(groups.map(group => group.id), undefined), negated };
    }

    private toPresentWhere(key: string, subAttribute: string | undefined): WhereFilter<ScimUserValue> {
        // an attribute without a sub-attribute is present when any value of it or its sub-attributes is
        return subAttribute == undefined ? { attribute: key } : { path: key };
    }

    private async findValueHolders(where: Where<ScimUserValue>): Promise<string[]> {
        const values: ScimUserValue[] = await this.values.findAll({ where, take: 'all' });
        return [...new Set(values.map(value => value.scimUserId))];
    }

    /**
     * Reads users for a list sorted by an attribute without a column of its own: those with a value
     * of it in its order, and those without one by id, last when ascending and first when descending
     * as a column without a value reads.
     * @param endpoint - The routes the list is answered for.
     * @param query - What the list asks for.
     * @param where - The alternatives of its filter.
     * @param sort - The attribute it sorts by.
     * @returns The list response.
     */
    private async resolveValueSortedPage(
        endpoint: ScimEndpoint,
        query: ScimListQuery,
        where: WhereFilter<ScimUser>[] | undefined,
        sort: ScimValueSort
    ): Promise<ScimBody> {
        const startIndex: number = this.resolveStartIndex(query);
        const count: number = this.resolveCount(query);
        const totalResults: number = await this.users.count({ where });
        // the values are narrowed to the users the filter finds, which reads every one of them: a
        // sort by a value with a filter is rare enough to pay that rather than keep the two together
        const filteredIds: string[] | undefined = where == undefined
            ? undefined
            : (await this.users.findAll({ where, take: 'all' })).map(user => user.id);
        const valueWhere: WhereFilter<ScimUserValue> = {
            path: { oneOf: sort.paths },
            sortValue: true,
            ...filteredIds == undefined ? {} : { scimUserId: { oneOf: filteredIds } }
        };
        const withValue: number = await this.values.count({ where: valueWhere });
        const withoutFirst: boolean = sort.direction === 'DESC';
        const firstSize: number = withoutFirst ? totalResults - withValue : withValue;
        const skip: number = startIndex - 1;
        const firstTake: number = Math.max(0, Math.min(count, firstSize - skip));
        const first: [number, number] = [Math.min(skip, firstSize), firstTake];
        const second: [number, number] = [Math.max(0, skip - firstSize), count - firstTake];
        const found: ScimUser[] = withoutFirst
            ? [
                ...await this.findUsersWithoutValue(where, valueWhere, ...first),
                ...await this.findUsersWithValue(valueWhere, sort, ...second)
            ]
            : [
                ...await this.findUsersWithValue(valueWhere, sort, ...first),
                ...await this.findUsersWithoutValue(where, valueWhere, ...second)
            ];
        const orphans: ScimUser[] = await this.findOrphans(found);
        if (orphans.length) {
            await this.removeOrphans(orphans);
            return await this.resolveValueSortedPage(endpoint, query, where, sort);
        }
        return this.toListBody(await this.resolveUserBodies(endpoint, found, query), totalResults, startIndex);
    }

    private async findUsersWithValue(
        valueWhere: WhereFilter<ScimUserValue>,
        sort: ScimValueSort,
        skip: number,
        take: number
    ): Promise<ScimUser[]> {
        if (take <= 0) {
            return [];
        }
        const values: ScimUserValue[] = await this.values.findAll({
            where: valueWhere,
            order: { text: sort.direction, number: sort.direction, boolean: sort.direction, scimUserId: 'ASC' },
            skip,
            take
        });
        const ids: string[] = values.map(value => value.scimUserId);
        const users: ScimUser[] = await this.users.findAll({ where: { id: { oneOf: ids } }, take: 'all' });
        const byId: Map<string, ScimUser> = new Map(users.map(user => [user.id, user]));
        return values.map(value => byId.get(value.scimUserId)).filter(user => user != undefined);
    }

    private async findUsersWithoutValue(
        where: WhereFilter<ScimUser>[] | undefined,
        valueWhere: WhereFilter<ScimUserValue>,
        skip: number,
        take: number
    ): Promise<ScimUser[]> {
        if (take <= 0) {
            return [];
        }
        const holders: string[] = await this.findValueHolders(valueWhere);
        const without: ScopedWhere<ScimUser> = ScopeWhereUtilities.applyToWhere(
            where,
            holders.length ? { id: { notOneOf: holders } } : undefined,
            MetadataUtilities.getModelProperties(ScimUser)
        );
        if (without.matchesNothing) {
            return [];
        }
        return await this.users.findAll({ where: without.where, order: { id: 'ASC' }, skip, take });
    }

    /**
     * Reads users for a list, removing a resource whose user is gone as it is found and reading the
     * page again without it.
     * @param endpoint - The routes the list is answered for.
     * @param query - What the list asks for.
     * @param where - The alternatives of its filter.
     * @param order - The order it reads in.
     * @returns The list response.
     */
    private async resolveUserPage(
        endpoint: ScimEndpoint,
        query: ScimListQuery,
        where: WhereFilter<ScimUser>[] | undefined,
        order: EntityOrder<ScimUser>
    ): Promise<ScimBody> {
        const startIndex: number = this.resolveStartIndex(query);
        const count: number = this.resolveCount(query);
        const totalResults: number = await this.users.count({ where });
        const found: ScimUser[] = count === 0 ? [] : await this.users.findAll({ where, order, skip: startIndex - 1, take: count });
        const orphans: ScimUser[] = await this.findOrphans(found);
        if (orphans.length) {
            await this.removeOrphans(orphans);
            return await this.resolveUserPage(endpoint, query, where, order);
        }
        return this.toListBody(await this.resolveUserBodies(endpoint, found, query), totalResults, startIndex);
    }

    /**
     * Applies a user resource as a request changed it.
     * @param endpoint - The routes the change came through.
     * @param scimUser - The user as it was kept.
     * @param input - The user as the request made it.
     * @param ifMatch - The versions the request allows the change on, if it names some.
     * @param transaction - The transaction of the request.
     * @returns The user resource.
     */
    private async updateUser(
        endpoint: ScimEndpoint,
        scimUser: ScimUser,
        input: ScimUserInput,
        ifMatch: string | undefined,
        transaction: Transaction
    ): Promise<ScimResourceResponse> {
        if (input.userName.toLowerCase() !== scimUser.userNameKey) {
            await this.validateUserNameFree(input.userName, scimUser.id, transaction);
        }
        const user: BaseUser<string> | undefined = await this.findApplicationUser(scimUser);
        if (user == undefined) {
            throw new ScimError(HttpStatus.NOT_FOUND, $ts`There is no user ${scimUser.id}.`);
        }
        if (scimUser.ownsUser) {
            await inject(endpoint.provisioner).resolveUpdatedUser({ id: scimUser.id, ...input }, user, transaction);
        }
        const updated: ScimUser = await this.writeVersioned(ifMatch, async () => await this.users.updateById(
            scimUser.id,
            {
                userName: input.userName,
                userNameKey: input.userName.toLowerCase(),
                // null rather than undefined: it clears an externalId the user no longer has
                // eslint-disable-next-line unicorn/no-null
                externalId: input.externalId ?? null,
                active: input.active,
                attributes: input.attributes,
                updatedAt: new Date(),
                version: scimUser.version + 1
            },
            { transaction, where: { version: scimUser.version } }
        ));
        await this.values.deleteAll({ scimUserId: scimUser.id }, { transaction });
        await this.values.createAll(ScimUserValueUtilities.toValues(scimUser.id, input.attributes), { transaction });
        if (scimUser.active !== input.active) {
            await this.updateActive(scimUser, user, input.active, transaction);
        }
        return await this.resolveUserResponse(endpoint, updated, EVERY_ATTRIBUTE, transaction);
    }

    /**
     * Deactivates or reactivates a provisioned user as far as the tenant reaches: everywhere when it
     * owns them, and their membership in it otherwise.
     * @param scimUser - The resource of the user.
     * @param user - The user it stands for.
     * @param active - Whether the identity provider has them active now.
     * @param transaction - The transaction of the request.
     */
    private async updateActive(scimUser: ScimUser, user: BaseUser<string>, active: boolean, transaction: Transaction): Promise<void> {
        if (scimUser.ownsUser) {
            await (active ? this.authService.reactivateUser(user.id, transaction) : this.authService.deactivateUser(user.id, transaction));
            return;
        }
        // null rather than undefined: it clears the column
        // eslint-disable-next-line unicorn/no-null
        await this.membershipService.updateDeactivatedAt(user.id, this.getActiveTenantId(), active ? null : new Date(), transaction);
    }

    /**
     * Gets the tenant the request provisions for.
     * @returns The tenant.
     * @throws When none is active, which the role check of the routes leaves no way to.
     */
    private getActiveTenantId(): string {
        const tenantId: string | undefined = this.tenantService.getActiveTenantId();
        if (tenantId == undefined) {
            throw new InternalError('SCIM provisions for a tenant, and none is active.');
        }
        return tenantId;
    }

    /**
     * Applies a group resource as a request changed it.
     * @param endpoint - The routes the change came through.
     * @param group - The group as it was kept.
     * @param memberIds - Its members as they were.
     * @param input - The group as the request made it.
     * @param ifMatch - The versions the request allows the change on, if it names some.
     * @param transaction - The transaction of the request.
     * @returns The group resource.
     */
    private async updateGroup(
        endpoint: ScimEndpoint,
        group: ScimGroup,
        memberIds: string[],
        input: ScimGroupInput,
        ifMatch: string | undefined,
        transaction: Transaction
    ): Promise<ScimResourceResponse> {
        const before: string[] = await this.resolveUsersUnder([group.id], transaction);
        const kept: Set<string> = new Set(input.memberIds);
        const removed: string[] = memberIds.filter(member => !kept.has(member));
        const existing: Set<string> = new Set(memberIds);
        const added: ScimMember[] = await this.resolveMembers(input.memberIds.filter(member => !existing.has(member)), transaction);
        if (removed.length) {
            await this.members.deleteAll({ groupId: group.id, memberId: { oneOf: removed } }, { transaction });
        }
        await this.members.createAll(
            added.map(member => ({ groupId: group.id, memberId: member.id, memberType: member.type })),
            { transaction }
        );
        const updated: ScimGroup = await this.writeVersioned(ifMatch, async () => await this.groups.updateById(
            group.id,
            {
                displayName: input.displayName,
                displayNameKey: input.displayName.toLowerCase(),
                // null rather than undefined: it clears an externalId the group no longer has
                // eslint-disable-next-line unicorn/no-null
                externalId: input.externalId ?? null,
                updatedAt: new Date(),
                version: group.version + 1
            },
            { transaction, where: { version: group.version } }
        ));
        const after: string[] = await this.resolveUsersUnder([group.id], transaction);
        // a renamed group is a different group to everyone in it, whose roles may follow its name.
        // Otherwise only who joined or left is affected, directly or through a group inside it
        const changed: boolean = updated.displayName !== group.displayName || updated.externalId !== group.externalId;
        const beforeSet: Set<string> = new Set(before);
        const afterSet: Set<string> = new Set(after);
        const affected: string[] = changed
            ? [...new Set([...before, ...after])]
            : [...before.filter(id => !afterSet.has(id)), ...after.filter(id => !beforeSet.has(id))];
        await this.applyGroupMembership(endpoint, affected, transaction);
        return await this.toGroupResponse(endpoint, updated, EVERY_ATTRIBUTE, transaction);
    }

    /**
     * Hands every given user, and all the groups they are a member of now, directly or through other
     * groups, to the provisioner.
     * @param endpoint - The routes the change came through.
     * @param scimUserIds - The ids of the SCIM resources of the users whose groups changed.
     * @param transaction - The transaction of the request.
     */
    private async applyGroupMembership(endpoint: ScimEndpoint, scimUserIds: string[], transaction: Transaction): Promise<void> {
        if (!scimUserIds.length) {
            return;
        }
        const scimUsers: ScimUser[] = await this.users.findAll({ where: { id: { oneOf: scimUserIds } }, take: 'all', transaction });
        const groupsOfUsers: Map<string, ScimUserGroup[]> = await this.resolveGroupsOfUsers(scimUserIds, transaction);
        const tenantId: string = this.getActiveTenantId();
        await PromiseUtilities.allChunked(scimUsers, async scimUser => {
            const user: BaseUser<string> | undefined = await this.findApplicationUser(scimUser);
            if (user == undefined) {
                return;
            }
            const membership: BaseMembership<string> = await this.membershipService.resolveMembership(user.id, tenantId, transaction);
            const ofUser: ScimGroupResource[] = (groupsOfUsers.get(scimUser.id) ?? []).map(entry => this.toGroupResource(entry.group));
            await inject(endpoint.provisioner).resolveGroupMembership(membership, ofUser, transaction);
        });
    }

    /**
     * The groups each given user is a member of, directly or through other groups, up as far as they
     * go.
     * @param scimUserIds - The ids of the SCIM resources of the users.
     * @param transaction - The transaction of the request, if any.
     * @returns The groups, by the id of the user: those they are a direct member of first.
     */
    private async resolveGroupsOfUsers(scimUserIds: string[], transaction: Transaction | undefined): Promise<Map<string, ScimUserGroup[]>> {
        if (!scimUserIds.length) {
            return new Map();
        }
        const direct: ScimGroupMember[] = await this.members.findAll({
            where: { memberId: { oneOf: scimUserIds }, memberType: ScimMemberType.USER },
            take: 'all',
            transaction
        });
        // the groups each group is a member of, up as far as they go: one read per level of nesting
        const parentsOf: Map<string, string[]> = new Map();
        const reached: Set<string> = new Set(direct.map(membership => membership.groupId));
        let level: string[] = [...reached];
        while (level.length) {
            const memberships: ScimGroupMember[] = await this.members.findAll({
                where: { memberId: { oneOf: level }, memberType: ScimMemberType.GROUP },
                take: 'all',
                transaction
            });
            level = [];
            for (const membership of memberships) {
                parentsOf.set(membership.memberId, [...parentsOf.get(membership.memberId) ?? [], membership.groupId]);
                if (!reached.has(membership.groupId)) {
                    reached.add(membership.groupId);
                    level.push(membership.groupId);
                }
            }
        }
        const groups: ScimGroup[] = reached.size
            ? await this.groups.findAll({ where: { id: { oneOf: [...reached] } }, take: 'all', transaction })
            : [];
        const byId: Map<string, ScimGroup> = new Map(groups.map(group => [group.id, group]));
        return new Map(scimUserIds.map(scimUserId => {
            const directIds: string[] = direct.filter(membership => membership.memberId === scimUserId)
                .map(membership => membership.groupId);
            const ofUser: ScimUserGroup[] = this.resolveAncestors(directIds, parentsOf)
                .map(id => byId.get(id))
                .filter(group => group != undefined)
                .map(group => ({ group, direct: directIds.includes(group.id) }));
            return [scimUserId, ofUser];
        }));
    }

    /**
     * The given groups and every group they are a member of, up as far as they go.
     * @param groupIds - The groups to start at.
     * @param parentsOf - The groups each group is a member of.
     * @returns Every group reached, each once, a loop of groups included.
     */
    private resolveAncestors(groupIds: string[], parentsOf: Map<string, string[]>): string[] {
        const reached: Set<string> = new Set(groupIds);
        const queue: string[] = [...groupIds];
        for (let next: string | undefined = queue.shift(); next != undefined; next = queue.shift()) {
            for (const parent of parentsOf.get(next) ?? []) {
                if (!reached.has(parent)) {
                    reached.add(parent);
                    queue.push(parent);
                }
            }
        }
        return [...reached];
    }

    /**
     * The users in the given groups, directly or through groups inside them, down as far as they go.
     * @param groupIds - The groups.
     * @param transaction - The transaction of the request, if any.
     * @returns The ids of the SCIM resources of the users, each once.
     */
    private async resolveUsersUnder(groupIds: string[], transaction: Transaction | undefined): Promise<string[]> {
        const users: Set<string> = new Set();
        const reached: Set<string> = new Set(groupIds);
        let level: string[] = groupIds;
        while (level.length) {
            const memberships: ScimGroupMember[] = await this.members.findAll({
                where: { groupId: { oneOf: level } },
                take: 'all',
                transaction
            });
            level = [];
            for (const membership of memberships) {
                if (membership.memberType === ScimMemberType.USER) {
                    users.add(membership.memberId);
                }
                else if (!reached.has(membership.memberId)) {
                    reached.add(membership.memberId);
                    level.push(membership.memberId);
                }
            }
        }
        return [...users];
    }

    /**
     * Finds what the members a request names are.
     * @param memberIds - The ids of their SCIM resources.
     * @param transaction - The transaction of the request.
     * @returns The members.
     * @throws A ScimError (invalidValue) when one is neither a provisioned user nor a group.
     */
    private async resolveMembers(memberIds: string[], transaction: Transaction): Promise<ScimMember[]> {
        if (!memberIds.length) {
            return [];
        }
        const notProvisioned: ScimError = new ScimError(
            HttpStatus.BAD_REQUEST,
            $ts`A member of the group is no provisioned user or group.`,
            ScimErrorType.INVALID_VALUE
        );
        if (!memberIds.every(id => UUIDUtilities.isUuid(id))) {
            throw notProvisioned;
        }
        const users: ScimUser[] = await this.users.findAll({ where: { id: { oneOf: memberIds } }, take: 'all', transaction });
        const groups: ScimGroup[] = await this.groups.findAll({ where: { id: { oneOf: memberIds } }, take: 'all', transaction });
        const types: Map<string, ScimMemberType> = new Map([
            ...users.map((user): [string, ScimMemberType] => [user.id, ScimMemberType.USER]),
            ...groups.map((group): [string, ScimMemberType] => [group.id, ScimMemberType.GROUP])
        ]);
        const members: ScimMember[] = [];
        for (const id of memberIds) {
            const type: ScimMemberType | undefined = types.get(id);
            if (type == undefined) {
                throw notProvisioned;
            }
            members.push({ id, type });
        }
        return members;
    }

    /**
     * Takes users or groups out of every group they are a member of.
     * @param memberIds - The ids of their SCIM resources.
     * @param transaction - The transaction of the request.
     */
    private async removeMembers(memberIds: string[], transaction: Transaction): Promise<void> {
        const memberships: ScimGroupMember[] = await this.members.findAll({
            where: { memberId: { oneOf: memberIds } },
            take: 'all',
            transaction
        });
        if (!memberships.length) {
            return;
        }
        await this.members.deleteAll({ memberId: { oneOf: memberIds } }, { transaction });
        // a group whose members changed is a new version of it, whatever changed them
        const groups: ScimGroup[] = await this.groups.findAll({
            where: { id: { oneOf: [...new Set(memberships.map(membership => membership.groupId))] } },
            take: 'all',
            transaction
        });
        await PromiseUtilities.allChunked(groups, async group => await this.writeVersioned(
            undefined,
            async () => await this.groups.updateById(
                group.id,
                { updatedAt: new Date(), version: group.version + 1 },
                { transaction, where: { version: group.version } }
            )
        ));
    }

    /**
     * Finds a provisioned user whose user still exists. A resource whose user is gone is removed as it
     * is found, which makes room for the identity provider to provision them anew.
     * @param id - The id of the resource.
     * @returns The resource.
     * @throws A ScimError (404) when there is no such user.
     */
    private async findLiveUser(id: string): Promise<ScimUser> {
        const scimUser: ScimUser = await this.findScimUser(id, undefined);
        if (await this.findApplicationUser(scimUser) == undefined) {
            await this.removeOrphans([scimUser]);
            throw new ScimError(HttpStatus.NOT_FOUND, $ts`There is no user ${id}.`);
        }
        return scimUser;
    }

    /**
     * Removes the resource holding a userName, when the user it stood for is gone.
     * @param userName - The userName.
     */
    private async removeOrphanedHolder(userName: string): Promise<void> {
        const holder: ScimUser | undefined = await this.users.findOne({ where: { userNameKey: userName.toLowerCase() }, required: false });
        if (holder != undefined && await this.findApplicationUser(holder) == undefined) {
            await this.removeOrphans([holder]);
        }
    }

    /**
     * The resources among the given ones whose user is gone.
     * @param scimUsers - The resources.
     * @returns Those whose user does not exist anymore.
     */
    private async findOrphans(scimUsers: ScimUser[]): Promise<ScimUser[]> {
        const users: (BaseUser<string> | undefined)[] = await PromiseUtilities.allChunked(
            scimUsers,
            async scimUser => await this.findApplicationUser(scimUser)
        );
        return scimUsers.filter((scimUser, index) => users[index] == undefined);
    }

    /**
     * Removes resources whose user is gone, deleted by the application rather than through SCIM, with
     * their memberships, in a transaction of their own.
     * @param orphans - The resources.
     */
    private async removeOrphans(orphans: ScimUser[]): Promise<void> {
        const ids: string[] = orphans.map(orphan => orphan.id);
        await this.inTransaction(async transaction => {
            await this.removeMembers(ids, transaction);
            await this.values.deleteAll({ scimUserId: { oneOf: ids } }, { transaction });
            await this.users.deleteAll({ id: { oneOf: ids } }, { transaction });
        });
        this.logger.info(`Removed ${ids.length} SCIM user resource(s) whose user does not exist anymore: ${ids.join(', ')}`);
    }

    private async findApplicationUser(scimUser: ScimUser): Promise<BaseUser<string> | undefined> {
        return await this.userService.findById<string, BaseUser<string>, false>(scimUser.userId, { required: false });
    }

    /**
     * Writes a resource on the condition that its version is the one that was read.
     * @param ifMatch - The versions the request allows the change on, if it names some.
     * @param write - The write.
     * @returns What it wrote.
     * @throws A ScimError when another request changed the resource in between.
     */
    private async writeVersioned<T>(ifMatch: string | undefined, write: () => Promise<T>): Promise<T> {
        try {
            return await write();
        }
        catch (error) {
            if (error instanceof ConflictError) {
                throw this.toConcurrentChangeError(ifMatch);
            }
            throw error;
        }
    }

    /**
     * Refuses a deletion that found the resource changed since it was read, which a deletion on the
     * condition of its version does by deleting nothing.
     * @param deleted - How many resources the deletion deleted.
     * @param ifMatch - The versions the request allows the deletion on, if it names some.
     * @throws A ScimError when it deleted none.
     */
    private validateDeleted(deleted: number, ifMatch: string | undefined): void {
        if (deleted !== 1) {
            throw this.toConcurrentChangeError(ifMatch);
        }
    }

    /**
     * The error for a resource another request changed between reading it and writing it.
     * @param ifMatch - The versions the request allows the change on, if it names some.
     * @returns A ScimError: 412 when the request named versions, 409 otherwise.
     */
    private toConcurrentChangeError(ifMatch: string | undefined): ScimError {
        return new ScimError(
            ifMatch == undefined ? HttpStatus.CONFLICT : HttpStatus.PRECONDITION_FAILED,
            $ts`The resource was changed by another request at the same time.`
        );
    }

    /**
     * Refuses a change the request allows only on versions the resource does not have.
     * @param version - The version of the resource.
     * @param ifMatch - The `If-Match` of the request, if it sent one.
     * @throws A ScimError (412) when it names none of the version.
     */
    private validateVersion(version: number, ifMatch: string | undefined): void {
        if (ifMatch == undefined) {
            return;
        }
        // compared as weak entity tags, which are the only ones the resources have
        const tags: string[] = ifMatch.split(',').map(tag => tag.trim().replace(/^W\//, ''));
        if (!tags.includes('*') && !tags.includes(`"${version}"`)) {
            throw new ScimError(HttpStatus.PRECONDITION_FAILED, $ts`The resource changed since the version the request names.`);
        }
    }

    /**
     * Reads a user resource a request sends.
     * @param body - The body, or the resource a patch made.
     * @returns The user.
     * @throws A ScimError (invalidValue) when it is no user.
     */
    private resolveUserInput(body: unknown): ScimUserInput {
        if (!ScimFilterUtilities.isRecord(body)) {
            throw new ScimError(HttpStatus.BAD_REQUEST, $ts`A user is a json object.`, ScimErrorType.INVALID_SYNTAX);
        }
        const userName: unknown = this.findAttribute(body, 'userName');
        if (typeof userName !== 'string' || !userName.trim()) {
            throw new ScimError(HttpStatus.BAD_REQUEST, $ts`A user needs a userName.`, ScimErrorType.INVALID_VALUE);
        }
        return {
            userName,
            externalId: this.resolveExternalId(body),
            active: this.resolveActive(this.findAttribute(body, 'active')),
            attributes: Object.fromEntries(Object.entries(body).filter(([key]) => !RESERVED_USER_ATTRIBUTES.includes(key.toLowerCase())))
        };
    }

    /**
     * Reads a group resource a request sends.
     * @param body - The body, or the resource a patch made.
     * @returns The group.
     * @throws A ScimError (invalidValue) when it is no group.
     */
    private resolveGroupInput(body: unknown): ScimGroupInput {
        if (!ScimFilterUtilities.isRecord(body)) {
            throw new ScimError(HttpStatus.BAD_REQUEST, $ts`A group is a json object.`, ScimErrorType.INVALID_SYNTAX);
        }
        const displayName: unknown = this.findAttribute(body, 'displayName');
        if (typeof displayName !== 'string' || !displayName.trim()) {
            throw new ScimError(HttpStatus.BAD_REQUEST, $ts`A group needs a displayName.`, ScimErrorType.INVALID_VALUE);
        }
        const members: unknown = this.findAttribute(body, 'members') ?? [];
        const memberIds: unknown[] = Array.isArray(members)
            ? members.map(member => ScimFilterUtilities.isRecord(member) ? this.findAttribute(member, 'value') : undefined)
            : [undefined];
        if (memberIds.some(memberId => typeof memberId !== 'string')) {
            throw new ScimError(
                HttpStatus.BAD_REQUEST,
                $ts`Every member of a group names the id of a user or a group as its value.`,
                ScimErrorType.INVALID_VALUE
            );
        }
        return {
            displayName,
            externalId: this.resolveExternalId(body),
            memberIds: [...new Set(memberIds.filter(memberId => typeof memberId === 'string').map(memberId => memberId.toLowerCase()))]
        };
    }

    /**
     * Reads the externalId a resource sends.
     * @param body - The resource.
     * @returns The externalId, or undefined when it sends none.
     * @throws A ScimError (invalidValue) when it is no string.
     */
    private resolveExternalId(body: Record<string, unknown>): string | undefined {
        const externalId: unknown = this.findAttribute(body, 'externalId');
        if (externalId != undefined && typeof externalId !== 'string') {
            throw new ScimError(HttpStatus.BAD_REQUEST, $ts`An externalId is a string.`, ScimErrorType.INVALID_VALUE);
        }
        return externalId ?? undefined;
    }

    /**
     * Reads whether a user is active.
     * @param active - The attribute as it was sent.
     * @returns Whether they are, which a user that does not say is.
     * @throws A ScimError (invalidValue) when it is neither true nor false.
     */
    private resolveActive(active: unknown): boolean {
        if (active == undefined) {
            return true;
        }
        if (typeof active === 'boolean') {
            return active;
        }
        // Entra ID sends it as a string in patch operations: "False"
        if (typeof active === 'string' && ['true', 'false'].includes(active.toLowerCase())) {
            return active.toLowerCase() === 'true';
        }
        throw new ScimError(HttpStatus.BAD_REQUEST, $ts`Whether a user is active is true or false.`, ScimErrorType.INVALID_VALUE);
    }

    private findAttribute(record: Record<string, unknown>, name: string): unknown {
        const key: string | undefined = ScimFilterUtilities.findKey(record, name);
        return key == undefined ? undefined : record[key];
    }

    private async validateUserNameFree(userName: string, exceptId: string | undefined, transaction: Transaction): Promise<void> {
        const holder: ScimUser | undefined = await this.users.findOne({
            where: { userNameKey: userName.toLowerCase() },
            required: false,
            transaction
        });
        if (holder != undefined && holder.id !== exceptId) {
            throw new ScimError(HttpStatus.CONFLICT, $ts`The userName ${userName} is taken.`, ScimErrorType.UNIQUENESS);
        }
    }

    private async findScimUser(id: string, transaction: Transaction | undefined): Promise<ScimUser> {
        const scimUser: ScimUser | undefined = UUIDUtilities.isUuid(id)
            ? await this.users.findOne({ where: { id }, required: false, transaction })
            : undefined;
        if (scimUser == undefined) {
            throw new ScimError(HttpStatus.NOT_FOUND, $ts`There is no user ${id}.`);
        }
        return scimUser;
    }

    private async findScimGroup(id: string, transaction: Transaction | undefined): Promise<ScimGroup> {
        const group: ScimGroup | undefined = UUIDUtilities.isUuid(id)
            ? await this.groups.findOne({ where: { id }, required: false, transaction })
            : undefined;
        if (group == undefined) {
            throw new ScimError(HttpStatus.NOT_FOUND, $ts`There is no group ${id}.`);
        }
        return group;
    }

    private async findMemberIds(groupId: string, transaction: Transaction | undefined): Promise<string[]> {
        const memberships: ScimGroupMember[] = await this.members.findAll({ where: { groupId }, take: 'all', transaction });
        return memberships.map(membership => membership.memberId);
    }

    /**
     * The groups each of the given members is a direct member of.
     * @param memberIds - The ids of the members.
     * @returns The ids of their groups, by the id of the member.
     */
    private async findGroupsOfMembers(memberIds: string[]): Promise<Map<string, string[]>> {
        const ids: string[] = [...new Set(memberIds.filter(id => UUIDUtilities.isUuid(id)))];
        const memberships: ScimGroupMember[] = ids.length
            ? await this.members.findAll({ where: { memberId: { oneOf: ids } }, take: 'all' })
            : [];
        const groupsOfMember: Map<string, string[]> = new Map();
        for (const membership of memberships) {
            groupsOfMember.set(membership.memberId, [...groupsOfMember.get(membership.memberId) ?? [], membership.groupId]);
        }
        return groupsOfMember;
    }

    private resolveStartIndex(query: ScimListQuery): number {
        return Math.max(1, Math.trunc(query.startIndex ?? 1));
    }

    private resolveCount(query: ScimListQuery): number {
        return Math.min(MAX_RESULTS, Math.max(0, Math.trunc(query.count ?? MAX_RESULTS)));
    }

    private resolveResourceTypes(endpoint: ScimEndpoint): ScimBody[] {
        return [
            {
                schemas: [ScimSchema.RESOURCE_TYPE],
                id: 'User',
                name: 'User',
                endpoint: '/Users',
                schema: ScimSchema.USER,
                schemaExtensions: [{ schema: ScimSchema.ENTERPRISE_USER, required: false }],
                meta: { resourceType: 'ResourceType', location: `${endpoint.url}/ResourceTypes/User` }
            },
            {
                schemas: [ScimSchema.RESOURCE_TYPE],
                id: 'Group',
                name: 'Group',
                endpoint: '/Groups',
                schema: ScimSchema.GROUP,
                meta: { resourceType: 'ResourceType', location: `${endpoint.url}/ResourceTypes/Group` }
            }
        ];
    }

    private async resolveUserResponse(
        endpoint: ScimEndpoint,
        scimUser: ScimUser,
        query: Pick<ScimListQuery, 'attributes' | 'excludedAttributes'>,
        transaction: Transaction | undefined
    ): Promise<ScimResourceResponse> {
        const groups: ScimUserGroup[] = this.isAnswered('groups', query)
            ? (await this.resolveGroupsOfUsers([scimUser.id], transaction)).get(scimUser.id) ?? []
            : [];
        return this.toUserResponse(endpoint, scimUser, query, groups);
    }

    private async resolveUserBodies(
        endpoint: ScimEndpoint,
        scimUsers: ScimUser[],
        query: Pick<ScimListQuery, 'attributes' | 'excludedAttributes'>
    ): Promise<ScimBody[]> {
        const groupsOfUsers: Map<string, ScimUserGroup[]> = this.isAnswered('groups', query)
            ? await this.resolveGroupsOfUsers(scimUsers.map(scimUser => scimUser.id), undefined)
            : new Map<string, ScimUserGroup[]>();
        return scimUsers.map(scimUser => this.toUserResponse(endpoint, scimUser, query, groupsOfUsers.get(scimUser.id) ?? []).body);
    }

    private toUserResponse(
        endpoint: ScimEndpoint,
        scimUser: ScimUser,
        query: Pick<ScimListQuery, 'attributes' | 'excludedAttributes'>,
        groups: ScimUserGroup[]
    ): ScimResourceResponse {
        const location: string = `${endpoint.url}/Users/${scimUser.id}`;
        const version: string = this.toEtag(scimUser.version);
        const extended: boolean = ScimFilterUtilities.findKey(scimUser.attributes, ScimSchema.ENTERPRISE_USER) != undefined;
        const body: ScimBody = {
            schemas: extended ? [ScimSchema.USER, ScimSchema.ENTERPRISE_USER] : [ScimSchema.USER],
            id: scimUser.id,
            ...scimUser.externalId == undefined ? {} : { externalId: scimUser.externalId },
            userName: scimUser.userName,
            active: scimUser.active,
            ...scimUser.attributes,
            ...groups.length
                ? {
                    groups: groups.map(entry => ({
                        value: entry.group.id,
                        $ref: `${endpoint.url}/Groups/${entry.group.id}`,
                        display: entry.group.displayName,
                        type: entry.direct ? 'direct' : 'indirect'
                    }))
                }
                : {},
            meta: {
                resourceType: 'User',
                created: new Date(scimUser.createdAt).toISOString(),
                lastModified: new Date(scimUser.updatedAt).toISOString(),
                location,
                version
            }
        };
        return { id: scimUser.id, body: this.project(body, query), version, location };
    }

    private async toGroupResponse(
        endpoint: ScimEndpoint,
        group: ScimGroup,
        query: Pick<ScimListQuery, 'attributes' | 'excludedAttributes'>,
        transaction: Transaction | undefined
    ): Promise<ScimResourceResponse> {
        const location: string = `${endpoint.url}/Groups/${group.id}`;
        const version: string = this.toEtag(group.version);
        const members: ScimBody[] | undefined = this.isAnswered('members', query)
            ? await this.resolveMemberBodies(endpoint, group.id, transaction)
            : undefined;
        const body: ScimBody = {
            schemas: [ScimSchema.GROUP],
            id: group.id,
            ...group.externalId == undefined ? {} : { externalId: group.externalId },
            displayName: group.displayName,
            ...members == undefined ? {} : { members },
            meta: {
                resourceType: 'Group',
                created: new Date(group.createdAt).toISOString(),
                lastModified: new Date(group.updatedAt).toISOString(),
                location,
                version
            }
        };
        return { id: group.id, body: this.project(body, query), version, location };
    }

    private async resolveMemberBodies(endpoint: ScimEndpoint, groupId: string, transaction: Transaction | undefined): Promise<ScimBody[]> {
        const memberships: ScimGroupMember[] = await this.members.findAll({ where: { groupId }, take: 'all', transaction });
        const userIds: string[] = memberships.filter(m => m.memberType === ScimMemberType.USER).map(m => m.memberId);
        const groupIds: string[] = memberships.filter(m => m.memberType === ScimMemberType.GROUP).map(m => m.memberId);
        const users: ScimUser[] = userIds.length
            ? await this.users.findAll({ where: { id: { oneOf: userIds } }, take: 'all', transaction })
            : [];
        const groups: ScimGroup[] = groupIds.length
            ? await this.groups.findAll({ where: { id: { oneOf: groupIds } }, take: 'all', transaction })
            : [];
        return [
            ...users.map(user => ({
                value: user.id,
                display: user.userName,
                type: ScimMemberType.USER,
                $ref: `${endpoint.url}/Users/${user.id}`
            })),
            ...groups.map(member => ({
                value: member.id,
                display: member.displayName,
                type: ScimMemberType.GROUP,
                $ref: `${endpoint.url}/Groups/${member.id}`
            }))
        ];
    }

    private toGroupResource(group: ScimGroup): ScimGroupResource {
        return { id: group.id, displayName: group.displayName, externalId: group.externalId ?? undefined };
    }

    private toEtag(version: number): string {
        return `W/"${version}"`;
    }

    private toListBody(resources: ScimBody[], totalResults: number, startIndex: number): ScimBody {
        return { schemas: [ScimSchema.LIST_RESPONSE], totalResults, startIndex, itemsPerPage: resources.length, Resources: resources };
    }

    /**
     * Narrows a resource to the attributes a request asks for. `id` and `schemas` are always answered.
     * @param resource - The resource.
     * @param query - Which attributes to answer with, or to leave out.
     * @returns The resource, narrowed.
     */
    private project(resource: ScimBody, query: Pick<ScimListQuery, 'attributes' | 'excludedAttributes'>): ScimBody {
        return Object.fromEntries(
            Object.entries(resource).filter(([key]) => key === 'id' || key === 'schemas' || this.isAnswered(key, query))
        );
    }

    private isAnswered(attribute: string, query: Pick<ScimListQuery, 'attributes' | 'excludedAttributes'>): boolean {
        const names: (list: string | undefined) => string[] = list => (list ?? '').split(',').map(name => name.trim().toLowerCase())
            .filter(name => name !== '');
        const attributes: string[] = names(query.attributes);
        if (attributes.length) {
            return attributes.includes(attribute.toLowerCase());
        }
        return !names(query.excludedAttributes).includes(attribute.toLowerCase());
    }

    /**
     * Reads the operations of a bulk request.
     * @param endpoint - The routes the request came through.
     * @param body - The request.
     * @returns The operations, in order.
     * @throws A ScimError when the request is no bulk request, or holds more operations than allowed.
     */
    private resolveBulkOperations(endpoint: ScimEndpoint, body: unknown): ScimBulkOperation[] {
        const invalid: (detail: string) => ScimError = detail => new ScimError(
            HttpStatus.BAD_REQUEST,
            $ts`${detail}`,
            ScimErrorType.INVALID_SYNTAX
        );
        const operations: unknown = ScimFilterUtilities.isRecord(body) ? this.findAttribute(body, 'Operations') : undefined;
        if (!Array.isArray(operations)) {
            throw invalid('A bulk request lists its Operations.');
        }
        if (operations.length > endpoint.maxBulkOperations) {
            throw new ScimError(
                HttpStatus.CONTENT_TOO_LARGE,
                $ts`A bulk request holds at most ${endpoint.maxBulkOperations} operations, this one ${operations.length}.`
            );
        }
        const bulkIds: Set<string> = new Set();
        return operations.map((operation: unknown, index): ScimBulkOperation => {
            if (!ScimFilterUtilities.isRecord(operation)) {
                throw invalid('An operation of a bulk request is a json object.');
            }
            const method: unknown = this.findAttribute(operation, 'method');
            const path: unknown = this.findAttribute(operation, 'path');
            const bulkId: unknown = this.findAttribute(operation, 'bulkId');
            const version: unknown = this.findAttribute(operation, 'version');
            if (typeof method !== 'string' || !BULK_METHODS.includes(method.toUpperCase()) || typeof path !== 'string') {
                throw invalid('An operation of a bulk request has a method, POST, PUT, PATCH or DELETE, and a path.');
            }
            if ((bulkId != undefined && typeof bulkId !== 'string') || (version != undefined && typeof version !== 'string')) {
                throw invalid('The bulkId and the version of an operation are strings.');
            }
            if (typeof bulkId === 'string') {
                if (bulkIds.has(bulkId)) {
                    throw invalid('Every bulkId of a bulk request is its own.');
                }
                bulkIds.add(bulkId);
            }
            return {
                index,
                method: method.toUpperCase(),
                bulkId: bulkId ?? undefined,
                version: version ?? undefined,
                path,
                data: this.findAttribute(operation, 'data')
            };
        });
    }

    /**
     * Reads after how many failed operations a bulk request stops.
     * @param body - The request.
     * @returns The number, or undefined to apply every operation whatever fails.
     * @throws A ScimError (invalidValue) when it is no whole number above 0.
     */
    private resolveFailOnErrors(body: unknown): number | undefined {
        const failOnErrors: unknown = ScimFilterUtilities.isRecord(body) ? this.findAttribute(body, 'failOnErrors') : undefined;
        if (failOnErrors == undefined) {
            return undefined;
        }
        if (typeof failOnErrors !== 'number' || !Number.isInteger(failOnErrors) || failOnErrors < 1) {
            throw new ScimError(HttpStatus.BAD_REQUEST, $ts`failOnErrors is a whole number above 0.`, ScimErrorType.INVALID_VALUE);
        }
        return failOnErrors;
    }

    private isBulkStopped(run: ScimBulkRun): boolean {
        return run.failOnErrors != undefined && run.errors >= run.failOnErrors;
    }

    private isBulkError(result: ScimBody): boolean {
        return typeof result['status'] === 'string' && Number(result['status']) >= 400;
    }

    /**
     * Applies one operation of a bulk request, answering what it did or why it failed.
     * @param endpoint - The routes the request came through.
     * @param operation - The operation.
     * @param created - The ids of the resources earlier operations created, by their bulkId. An
     * operation creating one adds it.
     * @returns The result of the operation.
     */
    private async resolveBulkResult(endpoint: ScimEndpoint, operation: ScimBulkOperation, created: Map<string, string>): Promise<ScimBody> {
        try {
            const path: unknown = this.replaceBulkIds(operation.path, created);
            const data: unknown = this.replaceBulkIds(operation.data, created);
            const match: RegExpExecArray | undefined = typeof path === 'string'
                ? /^\/(Users|Groups)(?:\/([^/]+))?$/.exec(path) ?? undefined
                : undefined;
            const resource: string | undefined = match?.[1];
            const id: string | undefined = match?.[2];
            if (resource == undefined || (operation.method === 'POST') !== (id == undefined)) {
                throw new ScimError(
                    HttpStatus.BAD_REQUEST,
                    $ts`A POST names /Users or /Groups, every other operation a resource, eg. /Users/{id}.`,
                    ScimErrorType.INVALID_PATH
                );
            }
            const users: boolean = resource === 'Users';
            if (id == undefined) {
                const response: ScimResourceResponse = users
                    ? await this.createUser(endpoint, data)
                    : await this.createGroup(endpoint, data);
                if (operation.bulkId != undefined) {
                    created.set(operation.bulkId, response.id);
                }
                return this.toBulkResult(operation, response.location, response.version, HttpStatus.CREATED);
            }
            if (operation.method === 'DELETE') {
                await (users ? this.deleteUser(endpoint, id, operation.version) : this.deleteGroup(endpoint, id, operation.version));
                return this.toBulkResult(operation, `${endpoint.url}/${resource}/${id}`, undefined, HttpStatus.NO_CONTENT);
            }
            const response: ScimResourceResponse = await this.resolveBulkChange(
                endpoint,
                operation.method,
                users,
                id,
                data,
                operation.version
            );
            return this.toBulkResult(operation, response.location, response.version, HttpStatus.OK);
        }
        catch (error) {
            return this.toBulkError(operation, error);
        }
    }

    private async resolveBulkChange(
        endpoint: ScimEndpoint,
        method: string,
        users: boolean,
        id: string,
        data: unknown,
        version: string | undefined
    ): Promise<ScimResourceResponse> {
        if (method === 'PUT') {
            return users ? await this.replaceUser(endpoint, id, data, version) : await this.replaceGroup(endpoint, id, data, version);
        }
        return users ? await this.patchUser(endpoint, id, data, version) : await this.patchGroup(endpoint, id, data, version);
    }

    private toBulkResult(operation: ScimBulkOperation, location: string, version: string | undefined, status: HttpStatus): ScimBody {
        return {
            method: operation.method,
            ...operation.bulkId == undefined ? {} : { bulkId: operation.bulkId },
            location,
            ...version == undefined ? {} : { version },
            status: `${status}`
        };
    }

    /**
     * The result of an operation of a bulk request that failed: its status, and the error a request
     * of its own would have answered with.
     * @param operation - The operation.
     * @param error - Why it failed.
     * @returns The result.
     */
    private toBulkError(operation: ScimBulkOperation, error: unknown): ScimBody {
        let status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
        let response: unknown;
        if (error instanceof ScimError) {
            status = error.status;
            response = error.body;
        }
        else if (error instanceof HttpError) {
            status = error.status;
            response = { schemas: [ScimSchema.ERROR], status: `${error.status}`, detail: error.message };
        }
        else {
            this.logger.error(new Error(`The operation ${operation.index} of a SCIM bulk request failed.`, { cause: error }));
            response = { schemas: [ScimSchema.ERROR], status: `${status}`, detail: 'Internal Server Error' };
        }
        return {
            method: operation.method,
            ...operation.bulkId == undefined ? {} : { bulkId: operation.bulkId },
            // a failed POST created nothing to point at
            ...operation.method === 'POST' ? {} : { location: operation.path },
            status: `${status}`,
            response
        };
    }

    /**
     * The bulkIds an operation refers to, as `bulkId:…` anywhere in its path or data.
     * @param operation - The operation.
     * @returns The bulkIds.
     */
    private findBulkReferences(operation: ScimBulkOperation): string[] {
        const inPath: string[] = operation.path.split('/').flatMap(segment => this.findBulkReferencesIn(segment));
        return [...this.findBulkReferencesIn(operation.data), ...inPath];
    }

    private findBulkReferencesIn(value: unknown): string[] {
        if (typeof value === 'string') {
            return value.startsWith(BULK_ID_PREFIX) ? [value.slice(BULK_ID_PREFIX.length)] : [];
        }
        const items: unknown[] = Array.isArray(value) ? value : ScimFilterUtilities.isRecord(value) ? Object.values(value) : [];
        return items.flatMap(item => this.findBulkReferencesIn(item));
    }

    /**
     * Leaves out of the data of an operation what refers to the given bulkIds: every item of a list
     * that does, say a member, and every attribute that is such a reference.
     * @param value - The data.
     * @param bulkIds - The bulkIds.
     * @returns The data, without them.
     */
    private withoutBulkReferences(value: unknown, bulkIds: Set<string>): unknown {
        const refers: (item: unknown) => boolean = item => this.findBulkReferencesIn(item).some(bulkId => bulkIds.has(bulkId));
        if (Array.isArray(value)) {
            return value.filter(item => !refers(item)).map(item => this.withoutBulkReferences(item, bulkIds));
        }
        if (ScimFilterUtilities.isRecord(value)) {
            return Object.fromEntries(Object.entries(value)
                .filter(([, item]) => !(typeof item === 'string' && refers(item)))
                .map(([key, item]) => [key, this.withoutBulkReferences(item, bulkIds)]));
        }
        return value;
    }

    /**
     * Replaces every `bulkId:…` the given value holds with the id of the resource created under it.
     * @param value - A path, or the data of an operation.
     * @param created - The ids of the created resources, by their bulkId.
     * @returns The value, with the ids in.
     */
    private replaceBulkIds(value: unknown, created: Map<string, string>): unknown {
        if (typeof value === 'string') {
            return value.split('/')
                .map(segment => segment.startsWith(BULK_ID_PREFIX) ? created.get(segment.slice(BULK_ID_PREFIX.length)) ?? segment : segment)
                .join('/');
        }
        if (Array.isArray(value)) {
            return value.map(item => this.replaceBulkIds(item, created));
        }
        if (ScimFilterUtilities.isRecord(value)) {
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.replaceBulkIds(item, created)]));
        }
        return value;
    }

    /**
     * Runs a change in a transaction of its own.
     * @param work - The change.
     * @returns What it answers with.
     */
    private async inTransaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
        const transaction: Transaction = await this.users.dataSource.startTransaction();
        try {
            const result: T = await work(transaction);
            await transaction.commit();
            return result;
        }
        catch (error) {
            await transaction.rollback();
            // two requests provisioning the same user at once, or a hook answering a user another
            // resource stands for already
            if (error instanceof UniqueConstraintViolationError) {
                throw new ScimError(HttpStatus.CONFLICT, $ts`The resource conflicts with one that exists.`, ScimErrorType.UNIQUENESS);
            }
            throw error;
        }
    }

    /**
     * Runs a change, and records it.
     * @param action - What is recorded.
     * @param work - The change.
     * @returns What it answers with.
     */
    private async audited<T>(action: AuditAction, work: () => Promise<AuditedResult<T>>): Promise<T> {
        try {
            const { result, userId } = await work();
            this.logger.audit({ action, outcome: AuditOutcome.SUCCESS, ...userId == undefined ? {} : { userId } });
            return result;
        }
        catch (error) {
            this.logger.audit({ action, outcome: AuditOutcome.FAILURE, reason: auditReasonFor(error) });
            throw error;
        }
    }
}