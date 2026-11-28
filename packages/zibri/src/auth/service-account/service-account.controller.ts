import { type ZibriApplication } from '../../application/application';
import { SpanningTransaction } from '../../data-source/transaction/spanning-transaction.model';
import { TransactionUtilities } from '../../data-source/transaction/transaction.utilities';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { type OnAppInit } from '../../global/on-app-init.interface';
import { HttpStatus } from '../../http/http-status.enum';
import { $ts } from '../../localization/translate.function';
import { Response } from '../../open-api/decorators/response.decorator';
import { Body } from '../../routing/decorators/body.decorator';
import { Delete } from '../../routing/decorators/delete.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { Put } from '../../routing/decorators/put.decorator';
import { type MembershipServiceInterface } from '../../tenancy/membership/membership-service.interface';
import { type Newable } from '../../types/newable.type';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function';
import { type AuthServiceInterface } from '../auth-service.interface';
import { Auth } from '../decorators/auth.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { type BaseUser } from '../models/base-user.model';
import { type Permission } from '../roles/permission.type';
import { type PlatformPermission } from '../roles/platform-permission.type';
import { type RoleServiceInterface } from '../roles/role-service.interface';
import { ApiKey } from '../strategies/api-key/api-key.model';
import { type CreatedApiKey } from '../strategies/api-key/created-api-key.model';
import { type UserServiceInterface } from '../user/user-service.interface';
import { CreatedServiceAccountApiKey } from './created-service-account-api-key.model';
import { NewServiceAccountApiKey } from './new-service-account-api-key.model';
import { NewServiceAccount } from './new-service-account.model';
import { ServiceAccountApiKey } from './service-account-api-key.model';
import { ServiceAccountRoles } from './service-account-roles.model';
import { ServiceAccount } from './service-account.model';
import { ServiceAccountUtilities } from './service-account.utilities';
import { ZibriServiceAccountPlatformPermissions } from './zibri-service-account-permissions.model';

/**
 * The methods of the user service the routes call, which a user service of an application implements from 4.0 on.
 */
type ServiceAccountUserMethods = Required<Pick<UserServiceInterface, 'createServiceAccount' | 'findServiceAccounts' | 'deleteUser'>>;

/**
 * The methods of the role and the membership service the routes call, which their services of an application
 * implement from 4.0 on.
 */
type ServiceAccountRoleMethods = Required<Pick<RoleServiceInterface, 'validateMayAssign'>>
    & Required<Pick<MembershipServiceInterface, 'findMembership'>>;

/**
 * The routes of the service accounts, below the path of the controller that extends it: listing them with their roles
 * and API keys, creating one with its roles, changing its roles, creating an API key for one, whose secret is answered
 * once, revoking a key, and deleting one with its keys. Listing is behind `service-accounts.read`, everything else
 * behind `service-accounts.manage`, both platform permissions. Roles are given and taken as `assignRole` and
 * `unassignRole` of the role service do, and tenant roles are those of the tenant the request acts in. A person is
 * never reached through them.
 */
// no @Controller of its own, for the reason MailingListController has none: the application's class extending this
// one says where the routes are. Every decorator is on a route rather than the class, which the application's class
// would not inherit
export abstract class ServiceAccountController implements OnAppInit {
    /**
     * The user entity new service accounts are created in, one a user repository reads.
     */
    protected abstract readonly userEntity: Newable<BaseUser<string>>;

    // read when used rather than injected, for the reason MailingListController reads its repository so
    private get authService(): AuthServiceInterface {
        return inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    }

    private get roleService(): RoleServiceInterface {
        return inject(ZIBRI_DI_TOKENS.ROLE_SERVICE);
    }

    private get membershipService(): MembershipServiceInterface {
        return inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        validateEntitiesRegistered(ServiceAccountController.name, app, ApiKey);
        // at boot rather than per request: the methods are optional until 4.0, and a service of the application
        // without them would answer every route with a 500
        this.resolveUserMethods();
        this.resolveRoleMethods();
    }

    @Auth.hasPlatformPermission(ZibriServiceAccountPlatformPermissions.SERVICE_ACCOUNTS_READ)
    @Response.array(ServiceAccount)
    @Get('/')
    async findServiceAccounts(): Promise<ServiceAccount[]> {
        const accounts: BaseUser<string>[] = await this.resolveUserMethods().findServiceAccounts(undefined);
        // one read per account of its keys and membership, which the services answer per user: an application has
        // a handful of service accounts
        return await Promise.all(accounts.map(async account => await this.resolveServiceAccountModel(account, undefined)));
    }

    @Auth.hasPlatformPermission(ZibriServiceAccountPlatformPermissions.SERVICE_ACCOUNTS_MANAGE)
    @Response.error(HttpStatus.BAD_REQUEST)
    @Response.error(HttpStatus.FORBIDDEN)
    @Response.error(HttpStatus.CONFLICT)
    @Response.object(ServiceAccount)
    @Post('/')
    async createServiceAccount(
        @CurrentUser()
        caller: CurrentUser,
        @Body(NewServiceAccount)
        input: NewServiceAccount
    ): Promise<ServiceAccount> {
        const tenantId: string | undefined = this.resolveTenantIdOfRoles(input.tenantRoles);
        const userMethods: ServiceAccountUserMethods = this.resolveUserMethods();
        const roleMethods: ServiceAccountRoleMethods = this.resolveRoleMethods();
        return await TransactionUtilities.runAndCommit(new SpanningTransaction(), async transaction => {
            // as an invitation checks its roles: the caller hands out each of them, at the level it is asked for
            await roleMethods.validateMayAssign(caller, input.roles, undefined, transaction);
            if (tenantId != undefined) {
                await roleMethods.validateMayAssign(caller, input.tenantRoles, tenantId, transaction);
            }
            const account: BaseUser<string> = await userMethods.createServiceAccount(
                this.userEntity,
                { name: input.name, roles: input.roles },
                transaction
            );
            if (tenantId != undefined) {
                await this.membershipService.resolveMembership(account.id, tenantId, transaction);
                await this.membershipService.updateRoles(account.id, tenantId, input.tenantRoles, transaction);
            }
            return await this.resolveServiceAccountModel(account, transaction);
        });
    }

    @Auth.hasPlatformPermission(ZibriServiceAccountPlatformPermissions.SERVICE_ACCOUNTS_MANAGE)
    @Response.error(HttpStatus.BAD_REQUEST)
    @Response.error(HttpStatus.FORBIDDEN)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.object(ServiceAccount)
    @Put('/:serviceAccountId/roles')
    async updateRoles(
        @CurrentUser()
        caller: CurrentUser,
        @Param.path('serviceAccountId', { type: 'string', format: 'uuid' })
        serviceAccountId: string,
        @Body(ServiceAccountRoles)
        input: ServiceAccountRoles
    ): Promise<ServiceAccount> {
        const tenantId: string | undefined = this.resolveTenantIdOfRoles(input.tenantRoles);
        const roleMethods: ServiceAccountRoleMethods = this.resolveRoleMethods();
        return await TransactionUtilities.runAndCommit(new SpanningTransaction(), async transaction => {
            const account: BaseUser<string> = await ServiceAccountUtilities.resolveServiceAccount(serviceAccountId, transaction);
            const tenantRoles: string[] = tenantId == undefined
                ? []
                : (await roleMethods.findMembership(account.id, tenantId, transaction))?.roles ?? [];
            const gained: string[] = input.roles.filter(role => !account.roles.includes(role));
            const gainedInTenant: string[] = input.tenantRoles.filter(role => !tenantRoles.includes(role));
            const lost: string[] = [...account.roles.filter(role => !input.roles.includes(role)), ...tenantRoles.filter(role => !input.tenantRoles.includes(role))];
            // assignRole takes the level from the role, so a role is checked against the level it is asked for first
            await roleMethods.validateMayAssign(caller, gained, undefined, transaction);
            if (tenantId != undefined && gainedInTenant.length) {
                await roleMethods.validateMayAssign(caller, gainedInTenant, tenantId, transaction);
                await this.membershipService.resolveMembership(account.id, tenantId, transaction);
            }
            // one after the other: the role service waits for the change before it of the same user, and the writes
            // of one transaction run over one connection
            for (const role of lost) {
                await this.roleService.unassignRole(caller, account.id, role, transaction);
            }
            for (const role of [...gained, ...gainedInTenant]) {
                await this.roleService.assignRole(caller, account.id, role, transaction);
            }
            return await this.resolveServiceAccountModel(
                await ServiceAccountUtilities.resolveServiceAccount(account.id, transaction),
                transaction
            );
        });
    }

    @Auth.hasPlatformPermission(ZibriServiceAccountPlatformPermissions.SERVICE_ACCOUNTS_MANAGE)
    // a key is a way in that outlives every login, as a password is
    @Auth.require2fa({ reauth: true })
    @Response.error(HttpStatus.BAD_REQUEST)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.object(CreatedServiceAccountApiKey)
    @Post('/:serviceAccountId/api-keys')
    async createApiKey(
        @Param.path('serviceAccountId', { type: 'string', format: 'uuid' })
        serviceAccountId: string,
        @Body(NewServiceAccountApiKey)
        input: NewServiceAccountApiKey
    ): Promise<CreatedServiceAccountApiKey> {
        const account: BaseUser<string> = await ServiceAccountUtilities.resolveServiceAccount(serviceAccountId, undefined);
        const created: CreatedApiKey = await this.authService.createApiKey(
            account.id,
            {
                name: input.name,
                permissions: this.resolvePermissions(input.permissions),
                tenantId: input.tenantId,
                expiresAt: input.expiresAt,
                // a secret: the key is sent in a header, or as the client secret at the token endpoint
                clientAuthentication: undefined,
                requireDpop: input.requireDpop
            },
            undefined
        );
        return { apiKey: this.toApiKeyModel(created.apiKey), key: created.key };
    }

    @Auth.hasPlatformPermission(ZibriServiceAccountPlatformPermissions.SERVICE_ACCOUNTS_MANAGE)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.empty()
    @Delete('/:serviceAccountId/api-keys/:apiKeyId')
    async revokeApiKey(
        @Param.path('serviceAccountId', { type: 'string', format: 'uuid' })
        serviceAccountId: string,
        @Param.path('apiKeyId', { type: 'string', format: 'uuid' })
        apiKeyId: string
    ): Promise<void> {
        const account: BaseUser<string> = await ServiceAccountUtilities.resolveServiceAccount(serviceAccountId, undefined);
        await this.authService.revokeApiKey(account.id, apiKeyId, undefined);
    }

    @Auth.hasPlatformPermission(ZibriServiceAccountPlatformPermissions.SERVICE_ACCOUNTS_MANAGE)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.empty()
    @Delete('/:serviceAccountId')
    async deleteServiceAccount(
        @Param.path('serviceAccountId', { type: 'string', format: 'uuid' })
        serviceAccountId: string
    ): Promise<void> {
        const userMethods: ServiceAccountUserMethods = this.resolveUserMethods();
        await TransactionUtilities.runAndCommit(new SpanningTransaction(), async transaction => {
            const account: BaseUser<string> = await ServiceAccountUtilities.resolveServiceAccount(serviceAccountId, transaction);
            // revoked rather than left to the deletion: a user entity that soft deletes keeps the keys of the user
            // until it is restored, and a restored service account gets no key back. What it proposed, such as
            // approval requests, stays, as the rows of a deleted person do
            await this.authService.revokeApiKeys(account.id, transaction);
            await userMethods.deleteUser(account.id, transaction);
        });
    }

    /**
     * Resolves a service account as the routes answer it, with its keys and its roles in the tenant of the request.
     * @param account - The service account.
     * @param transaction - The transaction to read in, if any.
     * @returns The service account.
     */
    protected async resolveServiceAccountModel(
        account: BaseUser<string>,
        transaction: SpanningTransaction | undefined
    ): Promise<ServiceAccount> {
        const tenantId: string | undefined = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).getActiveTenantId();
        const [apiKeys, tenantRoles] = await Promise.all([
            this.authService.findApiKeys(account.id, transaction),
            tenantId == undefined
                ? []
                : this.resolveRoleMethods().findMembership(account.id, tenantId, transaction).then(membership => membership?.roles ?? [])
        ]);
        return {
            id: account.id,
            name: ServiceAccountUtilities.getName(account),
            roles: account.roles,
            tenantRoles,
            apiKeys: apiKeys.map(apiKey => this.toApiKeyModel(apiKey))
        };
    }

    private toApiKeyModel(apiKey: ApiKey): ServiceAccountApiKey {
        return {
            id: apiKey.id,
            name: apiKey.name,
            permissions: apiKey.permissions,
            tenantId: apiKey.tenantId ?? undefined,
            expiresAt: apiKey.expiresAt ?? undefined,
            lastUsedAt: apiKey.lastUsedAt ?? undefined,
            createdAt: apiKey.createdAt,
            requireDpop: apiKey.requireDpop
        };
    }

    /**
     * Resolves the permissions a key is asked for, each as the level the application declares it at.
     * @param permissions - The permissions.
     * @returns The permissions.
     * @throws {BadRequestError} For one the application does not declare.
     */
    private resolvePermissions(permissions: string[]): (Permission | PlatformPermission)[] {
        const roleService: RoleServiceInterface = this.roleService;
        const isDeclared: (permission: string) => permission is Permission | PlatformPermission = (permission): permission is Permission | PlatformPermission => {
            return roleService.isPermission(permission) || roleService.isPlatformPermission(permission);
        };
        const undeclared: string | undefined = permissions.find(permission => !isDeclared(permission));
        if (undeclared != undefined) {
            throw new BadRequestError($ts`The permission '${undeclared}' is not declared.`);
        }
        return permissions.filter(isDeclared);
    }

    /**
     * Resolves the tenant whose roles a request gives: the one it acts in.
     * @param tenantRoles - The tenant roles it gives.
     * @returns The id of the tenant, or undefined for a request that acts in none.
     * @throws {BadRequestError} For tenant roles of a request that acts in no tenant.
     */
    private resolveTenantIdOfRoles(tenantRoles: string[]): string | undefined {
        const tenantId: string | undefined = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).getActiveTenantId();
        if (tenantId == undefined && tenantRoles.length) {
            throw new BadRequestError($ts`Tenant roles need a request that acts in a tenant.`);
        }
        return tenantId;
    }

    private resolveUserMethods(): ServiceAccountUserMethods {
        const service: UserServiceInterface = inject(ZIBRI_DI_TOKENS.USER_SERVICE);
        const { createServiceAccount, findServiceAccounts, deleteUser } = service;
        if (createServiceAccount == undefined || findServiceAccounts == undefined || deleteUser == undefined) {
            throw new InternalError(
                `${ServiceAccountController.name} needs a user service with createServiceAccount, findServiceAccounts and deleteUser.`
            );
        }
        return {
            createServiceAccount: createServiceAccount.bind(service),
            findServiceAccounts: findServiceAccounts.bind(service),
            deleteUser: deleteUser.bind(service)
        };
    }

    private resolveRoleMethods(): ServiceAccountRoleMethods {
        const roleService: RoleServiceInterface = this.roleService;
        const membershipService: MembershipServiceInterface = this.membershipService;
        const { validateMayAssign } = roleService;
        const { findMembership } = membershipService;
        if (validateMayAssign == undefined || findMembership == undefined) {
            throw new InternalError(
                `${ServiceAccountController.name} needs a role service with validateMayAssign and a membership service with findMembership.`
            );
        }
        return { validateMayAssign: validateMayAssign.bind(roleService), findMembership: findMembership.bind(membershipService) };
    }
}
