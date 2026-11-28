import type { ZibriApplication } from '../application/application';
import { type CurrentUser } from '../auth/decorators/current-user.decorator';
import { type BaseInvitation } from '../auth/invitation/base-invitation.model';
import { type AnyLevelPermissions } from '../auth/models/any-level-permissions.model';
import { type BaseUser } from '../auth/models/base-user.model';
import { type Permission } from '../auth/roles/permission.type';
import { type RouteAuthServiceInterface } from '../auth/route-auth-service.interface';
import { AlsUtilities } from '../context/als.utilities';
import { type EntitySelection } from '../entity/models/entity-selection.model';
import { type Where } from '../data-source/models/where/where-filter.model';
import { type Repository } from '../data-source/repository/repository';
import { resolveEntityScopeContext } from '../data-source/scopes/resolve-entity-scope-context.function';
import { type RepositoryTransaction } from '../data-source/transaction/repository-transaction.type';
import { type EntityWriteObserver } from '../data-source/write-observers/entity-write-observer.model';
import { EntityWriteObserverRegistry } from '../data-source/write-observers/entity-write-observer.registry';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { type DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { USER_ENTITY } from '../data-source/repository/repository-kind.model';
import { inject } from '../di/inject.function';
import { type BaseEntity } from '../entity/base-entity.model';
import { type PropertyMetadata } from '../entity/decorators/property.decorator';
import { denyAll, type DenyAll, type EntityScopeContext } from '../entity/models/entity-scope.model';
import { type EntityShareable } from '../entity/models/entity-shareable.model';
import { Relation } from '../entity/models/relation.enum';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { ForbiddenError } from '../error-handling/errors/forbidden.error';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { InternalError } from '../error-handling/internal-error.model';
import { OnAppInit } from '../global/on-app-init.interface';
import { $ts } from '../localization/translate.function';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';
import { PendingRowShare } from './pending-row-share.model';
import { RowShareGrant } from './row-share-grant.model';
import { RowShare, RowShareCreateData } from './row-share.model';
import { ShareByEmailResult, ShareInvitationData } from './share-by-email.model';
import { ShareServiceInterface } from './share-service.interface';
import { ShareableRowWriteObserver } from './shareable-row.write-observer';

/**
 * A shareable entity, as the application declares it.
 */
type ShareableEntity = {
    /**
     * The entity.
     */
    entityClass: Newable<BaseEntity>,
    /**
     * Its table name, which its shares name it by.
     */
    tableName: string,
    /**
     * What it declares as `shareable`.
     */
    shareable: EntityShareable,
    /**
     * The column a row holds its parent in, undefined for rows shared one by one.
     */
    parentColumn: string | undefined
};

/**
 * The relation an entity is shared through, to the entity its rows belong to.
 */
type SharedThroughHop = {
    /**
     * The column a row holds the row it belongs to in.
     */
    joinColumn: string,
    /**
     * The entity of that row.
     */
    target: Newable<BaseEntity>
};

/**
 * Who the rows are found visible for, and where.
 */
type Viewer = {
    /**
     * The id of the user.
     */
    userId: string,
    /**
     * The tenant the request acts in.
     */
    tenantId: string,
    /**
     * The request, which what is found is kept for.
     */
    requestContext: object,
    /**
     * The transaction the rows are read in, if any.
     */
    transaction: RepositoryTransaction | undefined
};

/**
 * The ids of the rows a viewer sees, per entity, and per tenant and user.
 */
type VisibleRows = Map<Newable<BaseEntity>, Map<string, Promise<string[]>>>;

/**
 * What one request found visible: outside a transaction, and inside each it read in.
 */
type VisibleRowsOfRequest = {
    /**
     * Outside a transaction.
     */
    outside: VisibleRows,
    /**
     * Inside each transaction, which sees the rows it wrote.
     */
    inTransaction: WeakMap<RepositoryTransaction, VisibleRows>
};

/**
 * Default share service implementation of Zibri, keeping the shares in `RowShare` and narrowing the rows of every
 * shareable entity, and of every entity shared through a relation, to what is shared with the caller.
 */
@Injectable({ register: 'onUse' })
export class ShareService implements ShareServiceInterface, OnAppInit {

    private readonly shareables: Map<Newable<BaseEntity>, ShareableEntity> = new Map();

    private readonly shareablesByTableName: Map<string, ShareableEntity> = new Map();

    private readonly hops: Map<Newable<BaseEntity>, SharedThroughHop> = new Map();

    // kept for the request alone, and forgotten by every write that could change it: the next request asks again,
    // which is what makes a share taken away end access with it
    private readonly visibleRows: WeakMap<object, VisibleRowsOfRequest> = new WeakMap();

    private get rowShareRepository(): Repository<RowShare, RowShareCreateData> {
        return inject(repositoryTokenFor(RowShare));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    get isEnabled(): boolean {
        return this.shareables.size > 0;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        const entities: Set<Newable<BaseEntity>> = new Set(app.options.dataSources.flatMap(d => inject(d).entities));
        for (const entityClass of entities) {
            const shareable: EntityShareable | undefined = MetadataUtilities.getEntityMetadata(entityClass)?.shareable;
            if (shareable != undefined) {
                this.registerShareable(entityClass, shareable);
            }
        }
        for (const entityClass of entities) {
            const sharedThrough: string | undefined = MetadataUtilities.getEntityMetadata(entityClass)?.sharedThrough;
            if (sharedThrough != undefined) {
                this.hops.set(entityClass, this.resolveHop(entityClass, sharedThrough));
            }
        }
        // each chain at once, so one that ends nowhere refuses the start rather than the first request reading it
        for (const entityClass of this.hops.keys()) {
            this.resolveRoot(entityClass);
        }
        if (!this.shareables.size) {
            return;
        }
        validateEntitiesRegistered(ShareService.name, app, RowShare);
        this.validateDataSources(app);
        const registry: EntityWriteObserverRegistry = inject(EntityWriteObserverRegistry);
        // a share given or taken, or a row of a chain written, changes what the request sees
        const forgetting: EntityWriteObserver = {
            properties: [],
            completeWrite: async () => {
                this.forgetVisibleRows();
            }
        };
        registry.register(RowShare, forgetting);
        for (const entityClass of this.hops.keys()) {
            registry.register(entityClass, forgetting);
        }
        for (const declared of this.shareables.values()) {
            registry.register(declared.entityClass, new ShareableRowWriteObserver(declared.parentColumn, {
                validateNotBelowItself: async (rowId, parentId, transaction) => await this.validateNotBelowItself(declared, rowId, parentId, transaction),
                deleteSharesOf: async (rowIds, transaction) => {
                    await this.rowShareRepository.deleteAll(
                        { entity: declared.tableName, rowId: { oneOf: rowIds } },
                        // ids name one row across every tenant, and a removal may reach across them
                        { transaction, acrossTenants: true }
                    );
                },
                forgetVisibleRows: () => this.forgetVisibleRows()
            }));
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async share(
        entityClass: Newable<BaseEntity>,
        rowId: string,
        userId: string,
        role: string,
        transaction: RepositoryTransaction | undefined
    ): Promise<RowShare> {
        const declared: ShareableEntity = this.getShareable(entityClass);
        this.validateRoleDeclared(declared, role);
        await this.validateRowsExist(declared, [rowId], transaction);
        const tenantId: string = this.getActiveTenantId();
        // a share is seen through a membership, so one with somebody who has none would never be
        const membership: unknown = await inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE).findActiveMembership(userId, tenantId, transaction);
        if (membership == undefined) {
            throw new BadRequestError($ts`The user needs to be an active member of the tenant to share a row with them.`);
        }
        const sharedBy: string | null = (await resolveEntityScopeContext(entityClass)).currentUser?.id ?? null;
        return await this.rowShareRepository.upsert(
            { entity: declared.tableName, rowId, userId },
            { tenantId, entity: declared.tableName, rowId, userId, role, sharedBy },
            { role: { set: role }, sharedBy: { set: sharedBy }, sharedAt: { set: new Date() } },
            { transaction }
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async unshare(entityClass: Newable<BaseEntity>, rowId: string, userId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        const declared: ShareableEntity = this.getShareable(entityClass);
        await this.rowShareRepository.deleteAll({ entity: declared.tableName, rowId, userId }, { transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findShares(entityClass: Newable<BaseEntity>, rowId: string): Promise<RowShare[]> {
        const declared: ShareableEntity = this.getShareable(entityClass);
        return await this.rowShareRepository.findAll({ where: { entity: declared.tableName, rowId }, limit: 'all' });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findSharesOfUser(userId: string): Promise<RowShare[]> {
        return await this.rowShareRepository.findAll({ where: { userId }, limit: 'all' });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveRole(entityClass: Newable<BaseEntity>, rowId: string, userId: string): Promise<string | undefined> {
        const shared: { declared: ShareableEntity, rowId: string } | undefined = await this.resolveShareableRow(entityClass, rowId);
        if (shared == undefined) {
            return undefined;
        }
        const ancestors: string[] | undefined = await this.resolveAncestorIds(shared.declared, shared.rowId, undefined);
        if (ancestors == undefined) {
            return undefined;
        }
        const shares: RowShare[] = await this.rowShareRepository.findAll({
            where: { entity: shared.declared.tableName, userId, rowId: { oneOf: ancestors } },
            limit: 'all'
        });
        // the highest along the way up: a row below grants more than the one above, never less
        const roles: readonly string[] = shared.declared.shareable.roles;
        const highest: number = Math.max(-1, ...shares.map(share => roles.indexOf(share.role)));
        return roles[highest];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveHasFullAccess(entityClass: Newable<BaseEntity>): Promise<boolean> {
        return await this.hasFullAccess(this.resolveRoot(entityClass), await resolveEntityScopeContext(entityClass));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validateRole(entityClass: Newable<BaseEntity>, rowId: string, role: string): Promise<void> {
        const root: ShareableEntity = this.resolveRoot(entityClass);
        const needed: number = root.shareable.roles.indexOf(role);
        if (needed < 0) {
            throw new InternalError(`The role '${role}' is none of the roles ${root.entityClass.name} declares: ${root.shareable.roles.join(', ')}.`);
        }
        const context: EntityScopeContext = await resolveEntityScopeContext(entityClass);
        if (await this.hasFullAccess(root, context)) {
            return;
        }
        const userId: string | undefined = context.currentUser?.id;
        const held: string | undefined = userId == undefined ? undefined : await this.resolveRole(entityClass, rowId, userId);
        // seen through a share on the row or one above it, which is what a role is held through: a row with no role
        // is one the caller does not see, and answered like one
        if (held == undefined) {
            throw new NotFoundError($ts`Could not find ${entityClass.name} with id "${rowId}".`);
        }
        if (root.shareable.roles.indexOf(held) < needed) {
            throw new ForbiddenError($ts`This needs a role of at least ${role} on the ${root.entityClass.name}.`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async shareByEmail<T extends BaseInvitation>(
        caller: CurrentUser,
        entityClass: Newable<BaseEntity>,
        rowId: string,
        email: string,
        role: string,
        invitation: ShareInvitationData<T>,
        transaction: RepositoryTransaction | undefined
    ): Promise<ShareByEmailResult<T>> {
        const tenantId: string = this.getActiveTenantId();
        const user: BaseUser<string> | undefined = await inject(ZIBRI_DI_TOKENS.USER_SERVICE)
            .findByEmail<string, BaseUser<string>, false>(email, { required: false, transaction });
        const member: unknown = user == undefined
            ? undefined
            : await inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE).findActiveMembership(user.id, tenantId, transaction);
        if (user != undefined && member != undefined) {
            return { share: await this.share(entityClass, rowId, user.id, role, transaction), invitation: undefined };
        }
        const invited: T = await inject(ZIBRI_DI_TOKENS.INVITATION_SERVICE).invite<T>(
            caller,
            { ...invitation, email, tenantId, rowShares: [{ entityClass, rowId, role }] },
            transaction
        );
        return { share: undefined, invitation: invited };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolvePendingShares(grants: RowShareGrant[], transaction: RepositoryTransaction | undefined): Promise<PendingRowShare[]> {
        const byEntity: Map<ShareableEntity, string[]> = new Map();
        const pending: PendingRowShare[] = grants.map(grant => {
            const declared: ShareableEntity = this.getShareable(grant.entityClass);
            this.validateRoleDeclared(declared, grant.role);
            byEntity.set(declared, [...byEntity.get(declared) ?? [], grant.rowId]);
            return { entity: declared.tableName, rowId: grant.rowId, role: grant.role };
        });
        await Promise.all([...byEntity].map(async ([declared, rowIds]) => await this.validateRowsExist(declared, rowIds, transaction)));
        return pending;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createPendingShares(
        userId: string,
        pending: PendingRowShare[],
        sharedBy: string,
        transaction: RepositoryTransaction | undefined
    ): Promise<void> {
        if (!pending.length) {
            return;
        }
        const tenantId: string = this.getActiveTenantId();
        await this.rowShareRepository.upsertAll(
            ['entity', 'rowId', 'userId'],
            pending.map(share => ({
                create: { tenantId, entity: share.entity, rowId: share.rowId, userId, role: share.role, sharedBy },
                onConflict: { role: { set: share.role }, sharedBy: { set: sharedBy }, sharedAt: { set: new Date() } }
            })),
            { transaction }
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveRestriction(
        entityClass: Newable<BaseEntity>,
        context: EntityScopeContext,
        transaction: RepositoryTransaction | undefined
    ): Promise<Where<BaseEntity> | DenyAll | undefined> {
        if (await this.hasFullAccess(this.resolveRoot(entityClass), context)) {
            return undefined;
        }
        // nobody to have shared anything with: anonymous, outside a request, or acting in no tenant
        if (context.currentUser == undefined || context.tenantId == undefined || context.requestContext == undefined) {
            return denyAll;
        }
        return await this.resolveSharedWhere(entityClass, {
            userId: context.currentUser.id,
            tenantId: context.tenantId,
            requestContext: context.requestContext,
            transaction
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteUserRows(userIds: string[], transaction: RepositoryTransaction): Promise<void> {
        await this.rowShareRepository.deleteAll({ userId: { oneOf: userIds } }, { transaction, acrossTenants: true });
    }

    /**
     * Refuses shares kept apart from the rows that delete them: a share is deleted in the transaction that deletes its
     * row or its user, which is one of the data source of that row or user.
     * @param app - The application that starts.
     * @throws When a user entity or a shareable entity is in no data source holding `RowShare`.
     */
    private validateDataSources(app: ZibriApplication): void {
        const dataSources: DataSourceInterface[] = app.options.dataSources.map(d => inject(d));
        const holding: DataSourceInterface | undefined = dataSources.find(d => d.entities.includes(RowShare));
        // a missing RowShare is refused with every other entity missing, once the application is up
        if (holding == undefined) {
            return;
        }
        // the entities of a sharedThrough chain delete no share: their rows are seen through a row, and hold none
        const deleting: Set<Newable<BaseEntity>> = new Set([
            ...dataSources.flatMap(d => d.entities.filter(entity => USER_ENTITY in entity)),
            ...this.shareables.keys()
        ]);
        const elsewhere: Newable<BaseEntity>[] = [...deleting].filter(entity => !holding.entities.includes(entity));
        if (!elsewhere.length) {
            return;
        }
        const placed: string = elsewhere
            .map(entity => `${entity.name} in ${dataSources.filter(d => d.entities.includes(entity)).map(d => d.constructor.name).join(', ')}`)
            .join(', ');
        throw new InternalError([
            `${ShareService.name} needs RowShare in the data source of the users and of every shareable entity,`,
            'as a share is deleted in the transaction that deletes its row or its user.',
            `RowShare is in ${holding.constructor.name}, and ${placed}.`
        ]);
    }

    /**
     * Has the request in which a write was made find what its caller sees anew.
     */
    private forgetVisibleRows(): void {
        const requestContext: object | undefined = AlsUtilities.getCurrentRequestContext();
        if (requestContext != undefined) {
            this.visibleRows.delete(requestContext);
        }
    }

    /**
     * Registers a shareable entity of the application.
     * @param entityClass - The entity.
     * @param shareable - What it declares.
     * @throws When its parent is a relation to another entity, or its permission is not declared.
     */
    private registerShareable(entityClass: Newable<BaseEntity>, shareable: EntityShareable): void {
        const tableName: string = MetadataUtilities.getEntityMetadata(entityClass)?.tableName ?? entityClass.name;
        const parent: SharedThroughHop | undefined = shareable.parent == undefined ? undefined : this.resolveHop(entityClass, shareable.parent);
        if (parent != undefined && parent.target !== entityClass) {
            throw new InternalError([
                `${entityClass.name}: The parent "${shareable.parent}" of "shareable" is a relation to ${parent.target.name}.`,
                'A row is shared with the rows below it, of the same entity: name a relation of the entity to itself.'
            ]);
        }
        const fullAccess: Permission | AnyLevelPermissions = shareable.fullAccess;
        const usedBy: string = `The "fullAccess" of ${entityClass.name}`;
        const routeAuthService: RouteAuthServiceInterface = inject(ZIBRI_DI_TOKENS.ROUTE_AUTH_SERVICE);
        if (typeof fullAccess === 'string') {
            routeAuthService.validatePermissionIsDeclared('tenant', fullAccess, usedBy);
        }
        else {
            routeAuthService.validatePermissionIsDeclared('tenant', fullAccess.permission, usedBy);
            routeAuthService.validatePermissionIsDeclared('platform', fullAccess.platformPermission, usedBy);
        }
        const declared: ShareableEntity = { entityClass, tableName, shareable, parentColumn: parent?.joinColumn };
        if (this.shareablesByTableName.has(tableName)) {
            throw new InternalError(`Two shareable entities are stored as "${tableName}", which their shares name them by.`);
        }
        this.shareables.set(entityClass, declared);
        this.shareablesByTableName.set(tableName, declared);
    }

    /**
     * Resolves the relation of an entity to the row a row belongs to.
     * @param entityClass - The entity.
     * @param relation - The relation, as the entity names it.
     * @returns The column the row is held in, and its entity.
     * @throws When the relation is no relation to one row, which the decorator refuses already.
     */
    private resolveHop(entityClass: Newable<BaseEntity>, relation: string): SharedThroughHop {
        const metadata: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(entityClass)[relation];
        if (metadata?.type !== Relation.MANY_TO_ONE && metadata?.type !== Relation.BELONGS_TO_ONE) {
            throw new InternalError(`${entityClass.name}: "${relation}" is no "manyToOne" or "belongsToOne" relation.`);
        }
        return { joinColumn: metadata.joinColumn, target: metadata.target() };
    }

    /**
     * Resolves the shareable entity an entity is, or is shared through.
     * @param entityClass - The entity.
     * @returns The shareable entity.
     * @throws When the entity is neither, or the relations it is shared through lead to none, or in a circle.
     */
    private resolveRoot(entityClass: Newable<BaseEntity>): ShareableEntity {
        const seen: Newable<BaseEntity>[] = [];
        for (let current: Newable<BaseEntity> = entityClass; ;) {
            const declared: ShareableEntity | undefined = this.shareables.get(current);
            if (declared != undefined) {
                return declared;
            }
            const hop: SharedThroughHop | undefined = this.hops.get(current);
            if (hop == undefined || seen.includes(current)) {
                const path: string = [...seen, current].map(e => e.name).join(' -> ');
                throw new InternalError([
                    `${entityClass.name} is shared through ${path}, which reaches no shareable entity of the data sources.`,
                    'An entity declared "sharedThrough" names a relation to a shareable entity, or to one shared through a relation in turn.'
                ]);
            }
            seen.push(current);
            current = hop.target;
        }
    }

    /**
     * Gets a shareable entity of the application.
     * @param entityClass - The entity.
     * @returns How it is shared.
     * @throws When it is not shareable.
     */
    private getShareable(entityClass: Newable<BaseEntity>): ShareableEntity {
        const declared: ShareableEntity | undefined = this.shareables.get(entityClass);
        if (declared == undefined) {
            throw new InternalError(`${entityClass.name} is no shareable entity of the data sources. Declare it with @Entity({ shareable }).`);
        }
        return declared;
    }

    /**
     * Gets the tenant the request acts in, which shares are of.
     * @returns The id of the tenant.
     * @throws When no tenant is active.
     */
    private getActiveTenantId(): string {
        const tenantId: string | undefined = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).getActiveTenantId();
        if (tenantId == undefined) {
            throw new InternalError('A row is shared in a tenant, and none is active.');
        }
        return tenantId;
    }

    /**
     * Refuses a role a shareable entity does not declare.
     * @param declared - The entity.
     * @param role - The role.
     * @throws A BadRequestError for a role it does not declare.
     */
    private validateRoleDeclared(declared: ShareableEntity, role: string): void {
        if (!declared.shareable.roles.includes(role)) {
            throw new BadRequestError($ts`The role '${role}' does not exist.`);
        }
    }

    /**
     * Refuses rows the tenant does not hold.
     * @param declared - The entity of the rows.
     * @param rowIds - Their ids.
     * @param transaction - The transaction to read in, if any.
     * @throws A NotFoundError for a row the tenant does not hold.
     */
    private async validateRowsExist(declared: ShareableEntity, rowIds: string[], transaction: RepositoryTransaction | undefined): Promise<void> {
        const unique: string[] = [...new Set(rowIds)];
        const found: BaseEntity[] = await this.repositoryOf(declared.entityClass).findAll({
            where: { id: { oneOf: unique } },
            select: { id: true },
            unscoped: true,
            limit: 'all',
            transaction
        });
        const missing: string | undefined = unique.find(id => !found.some(row => row.id === id));
        if (missing != undefined) {
            throw new NotFoundError($ts`Could not find ${declared.entityClass.name} with id "${missing}".`);
        }
    }

    /**
     * Refuses a parent that is the row itself, or a row below it.
     * @param declared - The entity.
     * @param rowId - The id of the row written.
     * @param parentId - The id of the parent it is given.
     * @param transaction - The transaction of the write, if any.
     * @throws A BadRequestError for such a parent.
     */
    private async validateNotBelowItself(
        declared: ShareableEntity,
        rowId: string,
        parentId: string,
        transaction: RepositoryTransaction | undefined
    ): Promise<void> {
        const above: string[] = await this.resolveAncestorIds(declared, parentId, transaction) ?? [parentId];
        if (above.includes(rowId)) {
            throw new BadRequestError($ts`The parent of a ${declared.entityClass.name} needs to be a row that is not below it.`);
        }
    }

    /**
     * Resolves a row and the rows above it, one read per row.
     * @param declared - The entity, which declares a parent.
     * @param rowId - The id of the row.
     * @param transaction - The transaction to read in, if any.
     * @returns The ids, the row first, or undefined when there is no such row.
     */
    private async resolveAncestorIds(
        declared: ShareableEntity,
        rowId: string,
        transaction: RepositoryTransaction | undefined
    ): Promise<string[] | undefined> {
        const parentColumn: string | undefined = declared.parentColumn;
        const repository: Repository<BaseEntity> = this.repositoryOf(declared.entityClass);
        const selection: EntitySelection<BaseEntity> = Object.fromEntries([['id', true], ...parentColumn == undefined ? [] : [[parentColumn, true]]]);
        const res: string[] = [];
        // stops at a row seen already as well, so rows stored in a circle before it was refused end the walk
        for (let current: string | undefined = rowId; current != undefined && !res.includes(current);) {
            const row: BaseEntity | undefined = await repository.findOne({
                where: { id: current },
                select: selection,
                unscoped: true,
                required: false,
                transaction
            });
            if (row == undefined) {
                return res.length ? res : undefined;
            }
            res.push(row.id);
            const parent: unknown = parentColumn == undefined ? undefined : Reflect.get(row, parentColumn);
            current = typeof parent === 'string' ? parent : undefined;
        }
        return res;
    }

    /**
     * Resolves the shareable row a row is, or belongs to through the relations its entity is shared through.
     * @param entityClass - The entity of the row.
     * @param rowId - The id of the row.
     * @returns The shareable entity and the id of its row, or undefined when a row along the way is not there.
     */
    private async resolveShareableRow(
        entityClass: Newable<BaseEntity>,
        rowId: string
    ): Promise<{ declared: ShareableEntity, rowId: string } | undefined> {
        // refuses an entity that is neither, before any read
        this.resolveRoot(entityClass);
        let current: Newable<BaseEntity> = entityClass;
        let currentId: string = rowId;
        for (let hop: SharedThroughHop | undefined = this.hops.get(current); hop != undefined; hop = this.hops.get(current)) {
            const row: BaseEntity | undefined = await this.repositoryOf(current).findOne({ where: { id: currentId }, unscoped: true, required: false });
            const next: unknown = row == undefined ? undefined : Reflect.get(row, hop.joinColumn);
            if (typeof next !== 'string') {
                return undefined;
            }
            current = hop.target;
            currentId = next;
        }
        return { declared: this.getShareable(current), rowId: currentId };
    }

    /**
     * Whether a caller sees every row of a shareable entity.
     * @param declared - The entity.
     * @param context - What is known about the caller.
     * @returns Whether their membership, or their own roles, carry its `fullAccess`.
     */
    private async hasFullAccess(declared: ShareableEntity, context: EntityScopeContext): Promise<boolean> {
        const fullAccess: Permission | AnyLevelPermissions = declared.shareable.fullAccess;
        return typeof fullAccess === 'string'
            ? await context.hasPermission(fullAccess)
            : await context.hasAnyLevelPermission(fullAccess);
    }

    /**
     * Resolves the filter narrowing an entity to the rows shared with a viewer.
     * @param entityClass - A shareable entity, or one shared through a relation.
     * @param viewer - Who the rows are for.
     * @returns The filter, or `denyAll` when nothing is shared with them.
     */
    private async resolveSharedWhere(entityClass: Newable<BaseEntity>, viewer: Viewer): Promise<Where<BaseEntity> | DenyAll> {
        const declared: ShareableEntity | undefined = this.shareables.get(entityClass);
        if (declared != undefined) {
            const ids: string[] = await this.resolveVisibleIds(entityClass, viewer);
            if (!ids.length) {
                return denyAll;
            }
            const byId: Where<BaseEntity> = { id: { oneOf: ids } };
            // the rows below a row seen are seen too, and so is one created below it within this request, which the
            // ids read before were not able to hold
            return declared.parentColumn == undefined ? byId : [byId, Object.fromEntries([[declared.parentColumn, { oneOf: ids }]])];
        }
        const hop: SharedThroughHop | undefined = this.hops.get(entityClass);
        if (hop == undefined) {
            throw new InternalError(`${entityClass.name} is neither shareable nor shared through a relation.`);
        }
        const ids: string[] = await this.resolveVisibleIds(hop.target, viewer);
        return ids.length ? Object.fromEntries([[hop.joinColumn, { oneOf: ids }]]) : denyAll;
    }

    /**
     * Resolves the ids of the rows of an entity a viewer sees, once per request, tenant and user.
     * @param entityClass - A shareable entity, or one shared through a relation.
     * @param viewer - Who the rows are for.
     * @returns The ids.
     */
    private async resolveVisibleIds(entityClass: Newable<BaseEntity>, viewer: Viewer): Promise<string[]> {
        let ofRequest: VisibleRowsOfRequest | undefined = this.visibleRows.get(viewer.requestContext);
        if (ofRequest == undefined) {
            ofRequest = { outside: new Map(), inTransaction: new WeakMap() };
            this.visibleRows.set(viewer.requestContext, ofRequest);
        }
        let visible: VisibleRows | undefined = viewer.transaction == undefined ? ofRequest.outside : ofRequest.inTransaction.get(viewer.transaction);
        if (visible == undefined && viewer.transaction != undefined) {
            visible = new Map();
            ofRequest.inTransaction.set(viewer.transaction, visible);
        }
        const ofEntity: Map<string, Promise<string[]>> = visible?.get(entityClass) ?? new Map<string, Promise<string[]>>();
        visible?.set(entityClass, ofEntity);
        const key: string = `${viewer.tenantId}:${viewer.userId}`;
        const found: Promise<string[]> | undefined = ofEntity.get(key);
        if (found != undefined) {
            return await found;
        }
        const resolving: Promise<string[]> = this.findVisibleIds(entityClass, viewer);
        ofEntity.set(key, resolving);
        // a read that failed is asked again rather than kept
        resolving.catch(() => ofEntity.delete(key));
        return await resolving;
    }

    /**
     * Finds the ids of the rows of an entity a viewer sees: those shared with them and the rows below, or those
     * belonging to such a row through the relation the entity is shared through.
     *
     * One read for the shares and one per level below them, or one per relation of the way to the shareable entity.
     * @param entityClass - A shareable entity, or one shared through a relation.
     * @param viewer - Who the rows are for.
     * @returns The ids.
     */
    private async findVisibleIds(entityClass: Newable<BaseEntity>, viewer: Viewer): Promise<string[]> {
        const declared: ShareableEntity | undefined = this.shareables.get(entityClass);
        // past every scope: what is shared is what decides here, and the entity's own scopes apply beside it
        if (declared == undefined) {
            const where: Where<BaseEntity> | DenyAll = await this.resolveSharedWhere(entityClass, viewer);
            return where === denyAll ? [] : await this.findIds(entityClass, where, viewer.transaction);
        }
        const shares: Pick<RowShare, 'id' | 'rowId'>[] = await this.rowShareRepository.findAll({
            where: { entity: declared.tableName, userId: viewer.userId },
            select: { id: true, rowId: true },
            limit: 'all',
            transaction: viewer.transaction
        });
        const visible: Set<string> = new Set(shares.map(share => share.rowId));
        const parentColumn: string | undefined = declared.parentColumn;
        if (parentColumn == undefined) {
            return [...visible];
        }
        // level by level, the same on every store: a row seen already ends the walk there, so rows stored in a
        // circle before it was refused end it too
        for (let level: string[] = [...visible]; level.length;) {
            const below: string[] = await this.findIds(entityClass, Object.fromEntries([[parentColumn, { oneOf: level }]]), viewer.transaction);
            level = below.filter(id => !visible.has(id));
            for (const id of level) {
                visible.add(id);
            }
        }
        return [...visible];
    }

    /**
     * Finds the ids of the rows matching a filter, past every scope.
     * @param entityClass - The entity.
     * @param where - The filter.
     * @param transaction - The transaction to read in, if any.
     * @returns The ids.
     */
    private async findIds(entityClass: Newable<BaseEntity>, where: Where<BaseEntity>, transaction: RepositoryTransaction | undefined): Promise<string[]> {
        const rows: BaseEntity[] = await this.repositoryOf(entityClass).findAll({
            where,
            select: { id: true },
            unscoped: true,
            limit: 'all',
            transaction
        });
        return rows.map(row => row.id);
    }

    /**
     * Gets the repository of an entity.
     * @param entityClass - The entity.
     * @returns Its repository.
     */
    private repositoryOf(entityClass: Newable<BaseEntity>): Repository<BaseEntity> {
        return inject(repositoryTokenFor(entityClass));
    }
}
