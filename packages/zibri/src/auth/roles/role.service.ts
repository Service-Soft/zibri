import { BaseRole } from './base-role.model';
import { PermissionDeclaration } from './permission-declaration.model';
import { type Permission } from './permission.type';
import { type PlatformPermission } from './platform-permission.type';
import { RoleCreateData } from './role-create-data.model';
import { RoleEventWriteObserver } from './role-event.write-observer';
import { RoleIdentity } from './role-identity.model';
import { RoleIndex } from './role-index.model';
import { RoleLevel } from './role-level.type';
import { isRoleRepository } from './role-repository.interface';
import { RoleServiceInterface } from './role-service.interface';
import { RoleUpdateData } from './role-update-data.model';
import { RoleUtilities } from './role.utilities';
import { RoleWriteObserver } from './role.write-observer';
import { TenantRoleIndex } from './tenant-role-index.model';
import { WrittenRole } from './written-role.model';
import { ZibriPermissions, ZibriPlatformPermissions } from './zibri-permissions.model';
import { ZibriApplication } from '../../application/application';
import { type AuditServiceInterface } from '../../audit/audit-service.interface';
import { type CacheServiceInterface } from '../../caching/cache-service.interface';
import { InMemoryCacheStore } from '../../caching/store/in-memory.cache-store';
import { Repository } from '../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { EntityWriteObserverRegistry } from '../../data-source/write-observers/entity-write-observer.registry';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { getDiTokenName } from '../../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../../di/get-registered-providers-of-variant.function';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { DiVariants } from '../../di/models/di-variant.model';
import { EntityMetadata } from '../../entity/decorators/entity.decorator';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { type EventTypeFor } from '../../event/event-type-for.type';
import { type RolesChangedEventData } from '../../event/roles-changed-event-data.model';
import { AfterAppInit } from '../../global/after-app-init.interface';
import { OnAppInit } from '../../global/on-app-init.interface';
import { type LeaseServiceInterface } from '../../leases/lease-service.interface';
import { $ts } from '../../localization/translate.function';
import { AuditAction, AuditOutcome, AuditReason } from '../../logging/audit-event.model';
import { AuditUtilities } from '../../logging/audit.utilities';
import { type LoggerInterface } from '../../logging/logger.interface';
import { BaseMembership } from '../../tenancy/membership/base-membership.model';
import { type MembershipServiceInterface } from '../../tenancy/membership/membership-service.interface';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { Ms } from '../../utilities/ms';
import { type CurrentUser } from '../decorators/current-user.decorator';
import { BaseUser } from '../models/base-user.model';
import { type UserServiceInterface } from '../user/user-service.interface';

/**
 * The tag the roles every tenant shares are invalidated by, on every instance.
 */
const ROLES_TAG: string = 'zibri.roles';

/**
 * What the tag the roles of one tenant's own are invalidated by starts with, followed by the tenant.
 */
const TENANT_ROLES_TAG_PREFIX: string = 'zibri.roles:';

const PERMISSIONS_TOKEN: string = 'ZIBRI_DI_TOKENS.PERMISSIONS';

/**
 * Which roles an operation is about: the tenant roles every tenant shares, the platform roles, or the
 * roles of a tenant's own.
 */
type RoleKind = RoleLevel | 'own';

/**
 * What can be done with a role.
 */
type RoleOperation = 'create' | 'update' | 'delete' | 'assign' | 'unassign';

/**
 * The permissions guarding an operation on a kind of role: the one allowing a role whose every
 * permission the caller holds, and the one allowing any role.
 */
type RoleGuard = {
    /**
     * Allows a role whose every permission the caller holds at its level.
     */
    withOwnPermissions: Permission | PlatformPermission,
    /**
     * Allows any role.
     */
    withAnyPermission: Permission | PlatformPermission
};

/**
 * The permissions declared in code, by level.
 */
type DeclaredPermissions = {
    /**
     * The tenant permissions.
     */
    tenant: ReadonlySet<string>,
    /**
     * The platform permissions.
     */
    platform: ReadonlySet<string>
};

/**
 * Default implementation of the service keeping the roles of an application, reading them from the
 * one role repository, such as one extending `BaseRoleRepository()`.
 */
@Injectable({ register: 'onUse' })
export class RoleService implements RoleServiceInterface, OnAppInit, AfterAppInit {

    private repository: Repository<BaseRole> | undefined;

    /**
     * Every role every tenant shares, indexed. Read again whenever one is written, on this instance
     * or another.
     */
    private index: RoleIndex = RoleUtilities.resolveRoleIndex([], { tenant: new Set(), platform: new Set() });

    /**
     * The roles of the tenants' own, by tenant: read with the first check in a tenant that needs
     * them, forgotten whenever one of them is written, and the least recently used given up first,
     * so that what this instance keeps stays bounded however many tenants there are.
     */
    // keyed by the tenant rather than per tenant: kept per tenant, the tenant had to be made active
    // around every access, and a check in the tenant and an invalidation from outside every tenant
    // only met by that
    private readonly tenantIndexes: InMemoryCacheStore<string, TenantRoleIndex> = new InMemoryCacheStore({ perTenant: false });

    /**
     * The reads of the roles of a tenant's own still running, so that the requests arriving in a
     * tenant at once read them once.
     */
    private readonly loadingTenantIndexes: Map<string, Promise<TenantRoleIndex>> = new Map();

    /**
     * The permissions declared in code, read once when first asked for.
     */
    private declared: DeclaredPermissions | undefined;

    /**
     * The roles each transaction holds the lease on, see withHeldRoles. Keyed by the transaction, so
     * an entry is gone with it.
     */
    private readonly heldUntilTransactionEnds: WeakMap<RepositoryTransaction, Set<string>> = new WeakMap();

    private get leaseService(): LeaseServiceInterface {
        return inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
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

    private get cacheService(): CacheServiceInterface {
        return inject(ZIBRI_DI_TOKENS.CACHE_SERVICE);
    }

    private get auditService(): AuditServiceInterface {
        return inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        const providers: DiProvider<unknown>[] = getRegisteredProvidersOfVariant(DiVariants.ROLE_REPO);
        if (providers.length > 1) {
            throw new InternalError([
                `Several role repositories are listed: ${providers.map(p => getDiTokenName(p.token)).join(', ')}.`,
                'The roles of an application are read from one place. Keep one of them.'
            ]);
        }
        const [provider] = providers;
        if (provider == undefined) {
            return;
        }
        const repository: unknown = inject(provider.token);
        // registered under the variant by its data source, which lists repository classes only
        if (!(repository instanceof Repository) || !isRoleRepository(repository)) {
            // eslint-disable-next-line stylistic/max-len
            throw new InternalError(`Invalid role repository: ${getDiTokenName(provider.token)} needs to extend BaseRoleRepository<Role>().`);
        }
        const metadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(repository.entityClass);
        if (metadata?.tenant === 'shared' || metadata?.tenant.property !== 'tenantId') {
            throw new InternalError([
                `The role entity ${repository.entityClass.name} does not keep its tenant in tenantId.`,
                'A role is one every tenant shares or one of a tenant\'s own: declare it with @Entity().'
            ]);
        }
        this.repository = repository;
        inject(EntityWriteObserverRegistry).register(repository.entityClass, new RoleWriteObserver(this));
        // only when the application named it, since it costs every write to roles an event
        const rolesChanged: EventTypeFor<RolesChangedEventData> | undefined = inject(ZIBRI_DI_TOKENS.FRAMEWORK_EVENT_NAMES).rolesChanged;
        if (rolesChanged != undefined) {
            inject(EntityWriteObserverRegistry).register(repository.entityClass, new RoleEventWriteObserver(rolesChanged));
        }
        this.cacheService.registerInvalidationListener(app, RoleService.name, ROLES_TAG, async () => await this.readRoles());
        this.cacheService.registerInvalidationListener(
            app,
            RoleService.name,
            tag => tag.startsWith(TENANT_ROLES_TAG_PREFIX),
            tag => {
                this.forgetTenantRoles(tag.slice(TENANT_ROLES_TAG_PREFIX.length));
                return Promise.resolve();
            }
        );
        this.logger.info(`configures the role repository ${getDiTokenName(provider.token)}`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async afterAppInit(): Promise<void> {
        // after init, once the data sources are up and the user and membership services know where
        // users and memberships are stored
        if (this.repository == undefined) {
            if (this.userService.userRepositories.length) {
                throw new InternalError([
                    'No role repository is listed.',
                    'The roles users and memberships hold are rows: declare a role entity, eg. one extending BaseRoleEntity, and its',
                    // eslint-disable-next-line stylistic/max-len
                    'repository with @RepositoryFor(Role) extending BaseRoleRepository<Role>(), and list it in the repositories of the data source.'
                ]);
            }
            return;
        }
        await this.readRoles();
        this.validateStoredRoles();
        await this.validateStoredTenantRoles();

        // every row is checked as it is written, so what this can find is a role deleted while rows
        // still held it, past the repository, or written before the rows were checked
        const [userRoles, memberRoles] = await Promise.all([
            this.userService.findUnknownRoles([...this.index.permissionsByRole.platform.keys()]),
            this.membershipService.findUnknownRoles(
                [...this.index.permissionsByRole.tenant.keys()],
                async tenantId => Object.keys(await this.resolveTenantIndex(tenantId))
            )
        ]);
        if (userRoles.length) {
            throw new InternalError([
                `Stored users hold ${this.describeRoles(userRoles)}, which no platform role is.`,
                'Create them again, or remove them from every user.'
            ]);
        }
        if (memberRoles.length) {
            throw new InternalError([
                `Stored memberships hold ${this.describeRoles(memberRoles)}, which no tenant role of their tenant is.`,
                'Create them again, or remove them from every membership.'
            ]);
        }
    }

    /**
     * Names roles in an error.
     * @param roles - The roles.
     * @returns Them, quoted.
     */
    private describeRoles(roles: string[]): string {
        const quoted: string = roles.map(role => `'${role}'`).join(', ');
        return `the ${roles.length > 1 ? 'roles' : 'role'} ${quoted}`;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    isPermission(value: string): value is Permission {
        return this.resolveDeclared().tenant.has(value);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    isPlatformPermission(value: string): value is PlatformPermission {
        return this.resolveDeclared().platform.has(value);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolvePermissionsOf(roles: string[], tenantId: string): Promise<Permission[]> {
        const own: TenantRoleIndex = await this.findTenantIndexFor(roles, tenantId);
        // a platform role carries nothing here, as it passes no check of this level
        const carried: Set<string> = new Set(roles.flatMap(role => this.index.permissionsByRole.tenant.get(role)
            ?? RoleUtilities.findTenantRolePermissions(own, role)
            ?? []));
        return [...carried].filter(permission => this.isPermission(permission));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolvePlatformPermissionsOf(roles: string[]): PlatformPermission[] {
        const carried: Set<string> = new Set(roles.flatMap(role => this.index.permissionsByRole.platform.get(role) ?? []));
        return [...carried].filter(permission => this.isPlatformPermission(permission));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validateRoles(roles: string[], tenantId: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        let index: RoleIndex = this.index;
        let own: TenantRoleIndex = await this.findTenantIndexFor(roles, tenantId);
        // a role created on another instance a moment ago is known here only once it is read again, so
        // a name this instance does not know is looked up before it is refused
        if (roles.some(role => !index.levels.has(role) && RoleUtilities.findTenantRolePermissions(own, role) == undefined)) {
            index = await this.readIndex(transaction);
            if (transaction == undefined) {
                this.forgetTenantRoles(tenantId);
                own = await this.findTenantIndexFor(roles, tenantId);
            }
            else {
                // kept nowhere, for the reason readIndex gives
                own = await this.readTenantRoles(tenantId, transaction);
            }
        }
        for (const role of roles) {
            if (index.levels.get(role) === 'platform') {
                throw new BadRequestError($ts`The role '${role}' is a platform role, and only tenant roles can be held here.`);
            }
            if (!index.levels.has(role) && RoleUtilities.findTenantRolePermissions(own, role) == undefined) {
                throw new BadRequestError($ts`The role '${role}' does not exist.`);
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validatePlatformRoles(roles: string[], transaction: RepositoryTransaction | undefined): Promise<void> {
        let index: RoleIndex = this.index;
        // for the reason validateRoles reads them again
        if (roles.some(role => !index.levels.has(role))) {
            index = await this.readIndex(transaction);
        }
        for (const role of roles) {
            const held: RoleLevel | undefined = index.levels.get(role);
            if (held == undefined) {
                throw new BadRequestError($ts`The role '${role}' does not exist.`);
            }
            if (held === 'tenant') {
                throw new BadRequestError($ts`The role '${role}' is a tenant role, and only platform roles can be held here.`);
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateRoleRows(rows: object[]): void {
        for (const row of rows) {
            const level: unknown = 'level' in row ? row.level : undefined;
            if (level != undefined && !RoleUtilities.isRoleLevel(level)) {
                throw new BadRequestError($ts`A role is held at the 'tenant' or the 'platform' level.`);
            }
            const permissions: unknown = 'permissions' in row ? row.permissions : undefined;
            for (const permission of Array.isArray(permissions) ? permissions.map(String) : []) {
                if (!this.isDeclaredAt(level ?? undefined, permission)) {
                    throw new BadRequestError($ts`The permission '${permission}' is not declared at the level of the role.`);
                }
            }
        }
    }

    /**
     * Whether a permission, or a wildcard, is declared at a level.
     * @param level - The level, undefined for a write changing only the permissions of a stored role.
     * @param permission - The permission, or a wildcard.
     * @returns Whether it is declared there, or at either level without one. A wildcard is when it
     * matches a permission declared there.
     */
    private isDeclaredAt(level: RoleLevel | undefined, permission: string): boolean {
        const { tenant, platform } = this.resolveDeclared();
        switch (level) {
            case 'tenant': {
                return this.isDeclaredIn(tenant, permission);
            }
            case 'platform': {
                return this.isDeclaredIn(platform, permission);
            }
            case undefined: {
                // what they may be is known only of the level the stored role keeps, and a permission
                // of the other level carries nothing there
                return this.isDeclaredIn(tenant, permission) || this.isDeclaredIn(platform, permission);
            }
        }
    }

    /**
     * Whether a permission, or a wildcard, is among the declared ones.
     * @param declared - The permissions declared at a level.
     * @param permission - The permission, or a wildcard.
     * @returns Whether it is declared, or the wildcard matches a declared one.
     */
    private isDeclaredIn(declared: ReadonlySet<string>, permission: string): boolean {
        // a misspelled prefix matches nothing, and is refused like a misspelled permission
        return RoleUtilities.expandPermissions([permission], declared).every(p => declared.has(p));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validateWrittenRoles(roles: WrittenRole[], transaction: RepositoryTransaction | undefined): Promise<void> {
        const platformOfTenant: WrittenRole | undefined = roles.find(role => role.tenantId != undefined && role.level === 'platform');
        if (platformOfTenant != undefined) {
            throw new BadRequestError(
                $ts`The role '${platformOfTenant.name}' is a platform role, and a platform role belongs to no tenant.`
            );
        }
        if (!roles.length) {
            return;
        }
        // every row of these names, the written ones as they are about to be rather than as stored.
        // Read across tenants, since a role every tenant shares is named apart from every tenant's own
        const written: Set<string | undefined> = new Set(roles.map(role => role.id));
        const stored: BaseRole[] = await this.getRepository().findAll({
            where: { name: { oneOf: [...new Set(roles.map(role => role.name))] } },
            acrossTenants: true,
            limit: 'all',
            transaction
        });
        const named: RoleIdentity[] = [
            ...stored.filter(role => !written.has(role.id)).map(role => ({ name: role.name, tenantId: role.tenantId ?? null })),
            ...roles
        ];
        for (const role of roles) {
            const shared: boolean = role.tenantId == undefined;
            if (named.some(other => other !== role && other.name === role.name && (other.tenantId == undefined) !== shared)) {
                throw new BadRequestError(shared
                    ? $ts`A tenant has a role of its own named '${role.name}', so no role every tenant shares can be named so.`
                    : $ts`The role '${role.name}' is one every tenant shares, so no tenant can have one of its own named so.`);
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validateRolesNotHeld(roles: RoleIdentity[]): Promise<void> {
        for (const role of roles) {
            // a tenant's own role is held by the members of that tenant alone, and no user holds one
            const [byUser, byMember] = await Promise.all([
                role.tenantId == undefined ? this.userService.isRoleHeld(role.name) : false,
                this.membershipService.isRoleHeld(role.name, role.tenantId ?? undefined)
            ]);
            if (byUser || byMember) {
                throw new BadRequestError($ts`The role '${role.name}' is still held. Take it from everybody who holds it first.`);
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async handleRolesChanged(tenantIds: (string | null)[]): Promise<void> {
        // through the invalidation, whose listeners read the roles again here first and then on every
        // other instance
        const tags: Set<string> = new Set(tenantIds.map(tenantId => tenantId == undefined
            ? ROLES_TAG
            : `${TENANT_ROLES_TAG_PREFIX}${tenantId}`));
        if (tags.size) {
            await this.cacheService.invalidateTags([...tags]);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findRoles<T extends BaseRole>(transaction?: RepositoryTransaction): Promise<T[]> {
        const roles: BaseRole[] = await this.getRepository().findAll({ order: { name: 'ASC' }, limit: 'all', transaction });
        // the caller names the type of its roles: the rows are theirs, read through their repository
        return roles as T[];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findRole<T extends BaseRole>(name: string, transaction?: RepositoryTransaction): Promise<T | undefined> {
        const role: BaseRole | undefined = await this.getRepository().findOne({ where: { name }, transaction, required: false });
        // the caller names the type of its roles, for the reason findRoles gives
        return role as T | undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createRole<T extends BaseRole>(
        caller: CurrentUser,
        data: RoleCreateData<T>,
        transaction: RepositoryTransaction | undefined
    ): Promise<T> {
        return await this.audited(AuditAction.ROLE_CREATED, caller, data.name, undefined, transaction, async () => {
            // a tenant's own role is checked against the caller's permissions in the tenant the request
            // acts in, and the data layer refuses one naming any other tenant
            const tenantId: string | undefined = data.tenantId ?? undefined;
            this.validateMayDefine(caller, tenantId == undefined ? data.level : 'own', 'create', [data.permissions]);
            if (await this.findRole(data.name, transaction) != undefined) {
                throw new BadRequestError($ts`A role named '${data.name}' exists already.`);
            }
            // one of the tenant's own where the request acts, one every tenant shares across them
            const created: BaseRole = tenantId == undefined
                ? await this.getRepository().create({ ...data, tenantId: null }, { transaction, acrossTenants: true })
                : await this.getRepository().create(data, { transaction });
            // the caller names the type of its roles, for the reason findRoles gives
            return created as T;
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateRole<T extends BaseRole>(
        caller: CurrentUser,
        name: string,
        data: RoleUpdateData<T>,
        transaction: RepositoryTransaction | undefined
    ): Promise<T> {
        return await this.audited(AuditAction.ROLE_UPDATED, caller, name, undefined, transaction, async () => {
            const role: BaseRole = await this.resolveRole(name, transaction);
            // as it is and as it becomes, so that neither narrowing a role wider than the caller nor
            // widening one past them gets through
            this.validateMayDefine(caller, this.resolveKind(role), 'update', [role.permissions, data.permissions ?? role.permissions]);
            const updated: BaseRole = await this.getRepository()
                .updateById(role.id, data, { transaction, acrossTenants: role.tenantId == undefined });
            // the caller names the type of its roles, for the reason findRoles gives
            return updated as T;
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteRole(caller: CurrentUser, name: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        await this.audited(AuditAction.ROLE_DELETED, caller, name, undefined, transaction, async () => {
            const role: BaseRole = await this.resolveRole(name, transaction);
            this.validateMayDefine(caller, this.resolveKind(role), 'delete', [role.permissions]);
            // refused while held by the repository, for every way a role is deleted
            await this.getRepository().deleteById(role.id, { transaction, acrossTenants: role.tenantId == undefined });
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async assignRole(caller: CurrentUser, userId: string, role: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        await this.audited(AuditAction.ROLE_ASSIGNED, caller, role, userId, transaction, async () => {
            await this.updateHeldRoles(caller, userId, role, 'assign', transaction, held => [...new Set([...held, role])]);
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async unassignRole(caller: CurrentUser, userId: string, role: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        await this.audited(AuditAction.ROLE_UNASSIGNED, caller, role, userId, transaction, async () => {
            await this.updateHeldRoles(caller, userId, role, 'unassign', transaction, held => held.filter(r => r !== role));
        });
    }

    /**
     * Gives a user a role or takes it from them: a platform role on the user, a tenant role on their
     * membership in the tenant the request acts in.
     * @param caller - Who asks.
     * @param userId - The user.
     * @param name - The role.
     * @param operation - Whether it is given or taken, for the permission it needs.
     * @param transaction - The transaction to write in, if any.
     * @param change - The roles held from now on, from those held so far.
     * @throws A ForbiddenError when the caller may not, a NotFoundError when there is no such role, user
     * or membership, a BadRequestError for a tenant role while no tenant is active.
     */
    private async updateHeldRoles(
        caller: CurrentUser,
        userId: string,
        name: string,
        operation: 'assign' | 'unassign',
        transaction: RepositoryTransaction | undefined,
        change: (held: string[]) => string[]
    ): Promise<void> {
        const role: BaseRole = await this.resolveRole(name, transaction);
        if (role.level === 'platform') {
            this.validateMayUse(
                caller.platformPermissions,
                this.findGuard(operation, 'platform'),
                role.permissions,
                caller.platformPermissions
            );
            await this.withHeldRoles(`roles:${userId}`, transaction, async () => {
                const user: BaseUser<string> = await this.userService.findById(userId, { transaction });
                await this.userService.updateRoles(userId, change(user.roles), transaction);
            });
            return;
        }
        const tenantId: string | undefined = this.tenantService.getActiveTenantId();
        if (tenantId == undefined) {
            throw new BadRequestError($ts`A tenant role is given and taken in the tenant a request acts in, and this one acts in none.`);
        }
        // a tenant permission, of the caller's membership in that tenant: whoever manages the roles of
        // a tenant does it there, those of its own as well as those every tenant shares
        this.validateMayUse(caller.permissions, this.findGuard(operation, 'tenant'), role.permissions, caller.permissions);
        await this.withHeldRoles(`roles:${tenantId}:${userId}`, transaction, async () => {
            const membership: BaseMembership<string> | undefined = await this.membershipService
                .findActiveMembership(userId, tenantId, transaction);
            if (membership == undefined) {
                throw new NotFoundError($ts`The user is no member of the tenant "${tenantId}".`);
            }
            await this.membershipService.updateRoles(userId, tenantId, change(membership.roles), transaction);
        });
    }

    /**
     * Reads and writes the roles a user or a membership holds, as the only one doing so, on every
     * instance, until the transaction of the write has ended.
     *
     * The roles are read and written back changed, so two of these at once both read what neither
     * wrote yet, and the later write took the earlier one's role away, in a transaction too.
     * @param key - What is held: the roles of a user, or of their membership in a tenant.
     * @param transaction - The transaction the roles are written in, if any.
     * @param work - Reads and writes them.
     */
    private async withHeldRoles(key: string, transaction: RepositoryTransaction | undefined, work: () => Promise<void>): Promise<void> {
        // a transaction that already holds the key holds it until it ends, so a second change in it
        // goes ahead rather than waiting for the transaction it is part of. Changes run in parallel
        // inside one transaction would each wait for the other
        const held: Set<string> | undefined = transaction == undefined ? undefined : this.heldUntilTransactionEnds.get(transaction);
        if (held?.has(key) === true) {
            await work();
            return;
        }
        await this.leaseService.withLease({ key, leaseInMs: Ms.SECOND * 30, mode: 'wait', heldUntil: transaction }, async () => {
            if (transaction != undefined) {
                const keys: Set<string> = this.heldUntilTransactionEnds.get(transaction) ?? new Set();
                keys.add(key);
                this.heldUntilTransactionEnds.set(transaction, keys);
            }
            await work();
        });
    }

    /**
     * Resolves which kind of role a stored role is.
     * @param role - The role.
     * @returns `'own'` for one of a tenant's own, its level otherwise.
     */
    private resolveKind(role: BaseRole): RoleKind {
        return role.tenantId == undefined ? role.level : 'own';
    }

    /**
     * Refuses a caller defining a role they may not: creating, changing or deleting it, which a
     * platform permission allows for a role every tenant shares, and a tenant permission in the tenant
     * for one of the tenant's own.
     * @param caller - Who asks.
     * @param kind - Which kind of role it is.
     * @param operation - What they do with it.
     * @param carried - The permissions the role carries, each set it does at some point of the operation.
     * @throws A ForbiddenError when the caller may not.
     */
    private validateMayDefine(caller: CurrentUser, kind: RoleKind, operation: 'create' | 'update' | 'delete', carried: string[][]): void {
        const guard: RoleGuard = this.findGuard(operation, kind);
        const granted: string[] = kind === 'own' ? caller.permissions : caller.platformPermissions;
        const own: string[] = kind === 'platform' ? caller.platformPermissions : caller.permissions;
        for (const permissions of carried) {
            this.validateMayUse(granted, guard, permissions, own);
        }
    }

    /**
     * Refuses a caller who holds neither permission of a guard, or holds the one allowing their own
     * permissions only and the role carries one they do not hold.
     * @param granted - The permissions of the caller at the level of the guard.
     * @param guard - The permissions guarding the operation.
     * @param carried - The permissions the role carries.
     * @param own - The permissions of the caller at the level of the role.
     * @throws A ForbiddenError when the caller may not.
     */
    private validateMayUse(granted: readonly string[], guard: RoleGuard, carried: readonly string[], own: readonly string[]): void {
        if (granted.includes(guard.withAnyPermission)) {
            return;
        }
        // a wildcard carries what a later release declares as well, which no permission held today
        // covers: whoever holds every permission there is still hands out more than they hold
        if (
            granted.includes(guard.withOwnPermissions)
            && !carried.some(permission => RoleUtilities.isWildcard(permission))
            && carried.every(permission => own.includes(permission))
        ) {
            return;
        }
        // worded like the refusal of a route, for the reason it gives: which permission is missing is
        // the authorization model, and the trail keeps it
        throw new ForbiddenError($ts`You do not have permission to manage this role.`);
    }

    /**
     * Finds the permissions guarding an operation on a kind of role, refusing an application that did
     * not declare them.
     * @param operation - What is done with the role.
     * @param kind - Which kind of role it is.
     * @returns The permissions.
     * @throws An InternalError when the application did not declare them, so nobody could hold them.
     */
    private findGuard(operation: RoleOperation, kind: RoleKind): RoleGuard {
        const guard: RoleGuard = this.resolveGuards()[operation][kind];
        // checked against the level the guard is held at, not the role's: handing out a tenant role
        // and defining a tenant's own are tenant permissions, defining any other role a platform one
        const handedOut: boolean = operation === 'assign' || operation === 'unassign';
        const declared: boolean = kind === 'own' || (handedOut && kind === 'tenant')
            ? this.isPermission(guard.withAnyPermission) && this.isPermission(guard.withOwnPermissions)
            : this.isPlatformPermission(guard.withAnyPermission) && this.isPlatformPermission(guard.withOwnPermissions);
        if (!declared) {
            throw new InternalError([
                `${guard.withAnyPermission} is not declared in ${PERMISSIONS_TOKEN}, so nobody may ${operation} a role.`,
                'Spread ZIBRI_PERMISSIONS into its permissions and ZIBRI_PLATFORM_PERMISSIONS into its platformPermissions.'
            ]);
        }
        return guard;
    }

    /**
     * Resolves the permissions guarding each operation on each kind of role.
     * @returns The guards.
     */
    private resolveGuards(): Record<RoleOperation, Record<RoleKind, RoleGuard>> {
        const assign: RoleGuard = {
            withOwnPermissions: ZibriPermissions.AUTH_ASSIGN_ROLE_WITH_OWN_PERMISSIONS,
            withAnyPermission: ZibriPermissions.AUTH_ASSIGN_ROLE_WITH_ANY_PERMISSION
        };
        const unassign: RoleGuard = {
            withOwnPermissions: ZibriPermissions.AUTH_UNASSIGN_ROLE_WITH_OWN_PERMISSIONS,
            withAnyPermission: ZibriPermissions.AUTH_UNASSIGN_ROLE_WITH_ANY_PERMISSION
        };
        return {
            create: {
                tenant: {
                    withOwnPermissions: ZibriPlatformPermissions.AUTH_CREATE_ROLE_WITH_OWN_PERMISSIONS,
                    withAnyPermission: ZibriPlatformPermissions.AUTH_CREATE_ROLE_WITH_ANY_PERMISSION
                },
                platform: {
                    withOwnPermissions: ZibriPlatformPermissions.AUTH_CREATE_PLATFORM_ROLE_WITH_OWN_PERMISSIONS,
                    withAnyPermission: ZibriPlatformPermissions.AUTH_CREATE_PLATFORM_ROLE_WITH_ANY_PERMISSION
                },
                own: {
                    withOwnPermissions: ZibriPermissions.AUTH_CREATE_TENANT_ROLE_WITH_OWN_PERMISSIONS,
                    withAnyPermission: ZibriPermissions.AUTH_CREATE_TENANT_ROLE_WITH_ANY_PERMISSION
                }
            },
            update: {
                tenant: {
                    withOwnPermissions: ZibriPlatformPermissions.AUTH_UPDATE_ROLE_WITH_OWN_PERMISSIONS,
                    withAnyPermission: ZibriPlatformPermissions.AUTH_UPDATE_ROLE_WITH_ANY_PERMISSION
                },
                platform: {
                    withOwnPermissions: ZibriPlatformPermissions.AUTH_UPDATE_PLATFORM_ROLE_WITH_OWN_PERMISSIONS,
                    withAnyPermission: ZibriPlatformPermissions.AUTH_UPDATE_PLATFORM_ROLE_WITH_ANY_PERMISSION
                },
                own: {
                    withOwnPermissions: ZibriPermissions.AUTH_UPDATE_TENANT_ROLE_WITH_OWN_PERMISSIONS,
                    withAnyPermission: ZibriPermissions.AUTH_UPDATE_TENANT_ROLE_WITH_ANY_PERMISSION
                }
            },
            delete: {
                tenant: {
                    withOwnPermissions: ZibriPlatformPermissions.AUTH_DELETE_ROLE_WITH_OWN_PERMISSIONS,
                    withAnyPermission: ZibriPlatformPermissions.AUTH_DELETE_ROLE_WITH_ANY_PERMISSION
                },
                platform: {
                    withOwnPermissions: ZibriPlatformPermissions.AUTH_DELETE_PLATFORM_ROLE_WITH_OWN_PERMISSIONS,
                    withAnyPermission: ZibriPlatformPermissions.AUTH_DELETE_PLATFORM_ROLE_WITH_ANY_PERMISSION
                },
                own: {
                    withOwnPermissions: ZibriPermissions.AUTH_DELETE_TENANT_ROLE_WITH_OWN_PERMISSIONS,
                    withAnyPermission: ZibriPermissions.AUTH_DELETE_TENANT_ROLE_WITH_ANY_PERMISSION
                }
            },
            // a tenant's own role is handed out in its tenant like any other tenant role
            assign: {
                tenant: assign,
                platform: {
                    withOwnPermissions: ZibriPlatformPermissions.AUTH_ASSIGN_PLATFORM_ROLE_WITH_OWN_PERMISSIONS,
                    withAnyPermission: ZibriPlatformPermissions.AUTH_ASSIGN_PLATFORM_ROLE_WITH_ANY_PERMISSION
                },
                own: assign
            },
            unassign: {
                tenant: unassign,
                platform: {
                    withOwnPermissions: ZibriPlatformPermissions.AUTH_UNASSIGN_PLATFORM_ROLE_WITH_OWN_PERMISSIONS,
                    withAnyPermission: ZibriPlatformPermissions.AUTH_UNASSIGN_PLATFORM_ROLE_WITH_ANY_PERMISSION
                },
                own: unassign
            }
        };
    }

    /**
     * Runs a role operation, recording that it happened or why it did not.
     * @param action - The operation.
     * @param caller - Who asks.
     * @param role - The role it is about.
     * @param subject - The user it gives a role to or takes one from, if any.
     * @param transaction - The transaction the operation writes in, if any.
     * @param operation - The operation.
     * @returns What the operation answers.
     */
    private async audited<T>(
        action: AuditAction,
        caller: CurrentUser,
        role: string,
        subject: string | undefined,
        transaction: RepositoryTransaction | undefined,
        operation: () => Promise<T>
    ): Promise<T> {
        try {
            const result: T = await operation();
            this.auditService.record({ action, outcome: AuditOutcome.SUCCESS, role, subject, userId: caller.id }, transaction);
            return result;
        }
        catch (error) {
            const reason: AuditReason = error instanceof ForbiddenError
                ? AuditReason.MISSING_PERMISSION
                : AuditUtilities.resolveReason(error);
            this.auditService.record({ action, outcome: AuditOutcome.FAILURE, reason, role, subject, userId: caller.id });
            throw error;
        }
    }

    /**
     * Resolves a role the active tenant sees by its name.
     * @param name - The name.
     * @param transaction - The transaction to read in, if any.
     * @returns The role.
     * @throws A NotFoundError when there is none.
     */
    private async resolveRole(name: string, transaction: RepositoryTransaction | undefined): Promise<BaseRole> {
        const role: BaseRole | undefined = await this.findRole(name, transaction);
        if (role == undefined) {
            throw new NotFoundError($ts`There is no role named '${name}'.`);
        }
        return role;
    }

    /**
     * Reads every role every tenant shares, and indexes it for the checks.
     */
    private async readRoles(): Promise<void> {
        this.index = await this.readSharedRoles(undefined);
    }

    /**
     * Reads every role every tenant shares again, for a check of a write: in the transaction of the
     * write, if any, which sees the roles it created itself. What a transaction reads is kept nowhere,
     * as it holds what the transaction has not committed, and maybe never will.
     * @param transaction - The transaction of the write, if any.
     * @returns The roles, indexed.
     */
    private async readIndex(transaction: RepositoryTransaction | undefined): Promise<RoleIndex> {
        if (transaction == undefined) {
            await this.readRoles();
            return this.index;
        }
        return await this.readSharedRoles(transaction);
    }

    /**
     * Reads every role every tenant shares, and indexes it for the checks.
     * @param transaction - The transaction to read in, if any.
     * @returns The roles, indexed.
     */
    private async readSharedRoles(transaction: RepositoryTransaction | undefined): Promise<RoleIndex> {
        const roles: BaseRole[] = await this.getRepository().findAll({
            where: { tenantId: null },
            acrossTenants: true,
            limit: 'all',
            transaction
        });
        return RoleUtilities.resolveRoleIndex(roles, this.resolveDeclared());
    }

    /**
     * Finds the roles of a tenant's own that a check of some roles needs: none when every one of them
     * is shared by every tenant, which a tenant without roles of its own never reads.
     * @param roles - The roles checked.
     * @param tenantId - The tenant.
     * @returns The roles of the tenant's own, or none.
     */
    private async findTenantIndexFor(roles: string[], tenantId: string): Promise<TenantRoleIndex> {
        return roles.every(role => this.index.levels.has(role)) ? {} : await this.resolveTenantIndex(tenantId);
    }

    /**
     * Resolves the roles of a tenant's own: from memory, or read once however many ask at a time.
     * @param tenantId - The tenant.
     * @returns The roles, indexed.
     */
    private async resolveTenantIndex(tenantId: string): Promise<TenantRoleIndex> {
        const kept: TenantRoleIndex | undefined = this.tenantIndexes.get(tenantId)?.value;
        if (kept != undefined) {
            return kept;
        }
        const running: Promise<TenantRoleIndex> | undefined = this.loadingTenantIndexes.get(tenantId);
        if (running != undefined) {
            return await running;
        }
        const loading: Promise<TenantRoleIndex> = this.readTenantRoles(tenantId, undefined);
        this.loadingTenantIndexes.set(tenantId, loading);
        try {
            const index: TenantRoleIndex = await loading;
            // kept only while no write forgot it in the meantime: a read started before the write would
            // keep what the write changed until the next one
            if (this.loadingTenantIndexes.get(tenantId) === loading) {
                this.tenantIndexes.set(tenantId, { createdAt: new Date(), value: index, tags: [] });
            }
            return index;
        }
        finally {
            if (this.loadingTenantIndexes.get(tenantId) === loading) {
                this.loadingTenantIndexes.delete(tenantId);
            }
        }
    }

    /**
     * Reads the roles of a tenant's own, and indexes them for the checks.
     * @param tenantId - The tenant.
     * @param transaction - The transaction to read in, if any.
     * @returns The roles, indexed.
     */
    private async readTenantRoles(tenantId: string, transaction: RepositoryTransaction | undefined): Promise<TenantRoleIndex> {
        const roles: BaseRole[] = await this.getRepository().findAll({
            where: { tenantId },
            acrossTenants: true,
            limit: 'all',
            transaction
        });
        return RoleUtilities.resolveTenantRoleIndex(roles, this.resolveDeclared().tenant);
    }

    /**
     * Forgets the roles of a tenant's own, so that the next check in the tenant reads them again.
     * @param tenantId - The tenant.
     */
    private forgetTenantRoles(tenantId: string): void {
        // the read still running too, so that it is not kept either
        this.loadingTenantIndexes.delete(tenantId);
        this.tenantIndexes.delete(tenantId);
    }

    /**
     * Refuses starting with a role every tenant shares carrying a permission that is not declared at
     * its level, such as one the code stopped declaring while a role still carried it.
     * @throws An InternalError naming the roles and permissions.
     */
    private validateStoredRoles(): void {
        const undeclared: string[] = [];
        for (const level of ['tenant', 'platform'] as const) {
            for (const [role, permissions] of this.index.permissionsByRole[level]) {
                const known: ReadonlySet<string> = this.resolveDeclared()[level];
                undeclared.push(...permissions
                    .filter(permission => !known.has(permission))
                    .map(permission => `'${permission}' of '${role}'`));
            }
        }
        if (undeclared.length) {
            throw new InternalError([
                `Stored roles carry ${undeclared.join(', ')}, not declared at their level in ${PERMISSIONS_TOKEN}.`,
                'Declare them again, or take them from the roles.'
            ]);
        }
    }

    /**
     * Refuses starting with a role of a tenant's own that is a platform role, or carries a permission
     * that is not declared as a tenant permission. Streamed, so that starting holds no more of them
     * in memory than one at a time.
     * @throws An InternalError naming the roles.
     */
    private async validateStoredTenantRoles(): Promise<void> {
        const platform: string[] = [];
        const undeclared: string[] = [];
        for await (const role of this.getRepository().stream({ where: { tenantId: { not: null } }, acrossTenants: true })) {
            if (role.level === 'platform') {
                platform.push(`'${role.name}' of ${role.tenantId ?? ''}`);
            }
            undeclared.push(...role.permissions
                .filter(permission => !this.isDeclaredAt('tenant', permission))
                .map(permission => `'${permission}' of '${role.name}'`));
        }
        if (platform.length) {
            throw new InternalError([
                `Stored roles of tenants are platform roles: ${platform.join(', ')}.`,
                'A platform role belongs to no tenant. Make them tenant roles, or roles every tenant shares.'
            ]);
        }
        if (undeclared.length) {
            throw new InternalError([
                `Stored roles of tenants carry ${undeclared.join(', ')}, not declared as tenant permissions in ${PERMISSIONS_TOKEN}.`,
                'Declare them again, or take them from the roles.'
            ]);
        }
    }

    /**
     * Gets the repository roles are read from and written to.
     * @returns The repository.
     * @throws When the application has none, which only an application without users can start with.
     */
    private getRepository(): Repository<BaseRole> {
        if (this.repository == undefined) {
            throw new InternalError('No role repository is listed, so there are no roles to read or write.');
        }
        return this.repository;
    }

    /**
     * Resolves the permissions declared in code, once.
     * @returns The permissions, by level.
     * @throws An InternalError when a permission is declared twice, or at both levels.
     */
    private resolveDeclared(): DeclaredPermissions {
        if (this.declared != undefined) {
            return this.declared;
        }
        const declaration: PermissionDeclaration | undefined = inject(ZIBRI_DI_TOKENS.PERMISSIONS);
        const tenant: Set<string> = new Set();
        const platform: Set<string> = new Set();
        const byLevel: readonly (readonly [readonly string[], Set<string>])[] = [
            [declaration?.permissions ?? [], tenant],
            [declaration?.platformPermissions ?? [], platform]
        ];
        for (const [permissions, into] of byLevel) {
            for (const permission of permissions) {
                if (tenant.has(permission) || platform.has(permission)) {
                    // at both levels too: a key or a scope names a permission without its level
                    throw new InternalError(`The permission '${permission}' is declared more than once in ${PERMISSIONS_TOKEN}.`);
                }
                into.add(permission);
            }
        }
        this.declared = { tenant, platform };
        return this.declared;
    }
}