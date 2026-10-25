# Roles and permissions
A route asks for a permission, and a role carries permissions. You declare every permission in code, each at the level it is held at: a tenant permission through a user's [membership](./tenancy.md#members-and-their-roles) in a tenant, a platform permission by the user themself. Roles are rows in your database, which your administrators create, change and hand out at runtime. A role is one every tenant shares, or one of a [tenant's own](#a-tenants-own-roles).

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `definePermissions`, `definePlatformPermissions` | function | Define your tenant and platform permissions, as an object to name them by like an enum |
| `DefinedPermissions`, `DefinedPlatformPermissions` | type | What the two functions above answer: every permission, by its name in upper case |
| `Permission`, `PlatformPermission` | type | A tenant and a platform permission, as only the two functions above make them |
| `PermissionDeclaration` | type | Every permission of your application, as `ZIBRI_DI_TOKENS.PERMISSIONS` takes them |
| `ZIBRI_DI_TOKENS.PERMISSIONS` | DI token | Provide your declaration |
| `ZIBRI_PERMISSIONS`, `ZIBRI_PLATFORM_PERMISSIONS` | constant | The permissions Zibri checks itself, for managing roles, to spread into yours |
| `ZibriPermissions`, `ZibriPlatformPermissions` | constant | The same, by name |
| `BaseRoleEntity`, `BaseRole` | class, type | What your role entity extends: a `name`, a `level`, the `tenantId` of a tenant's own role and the `permissions` it carries |
| `BaseRoleRepository`, `RoleRepositoryInterface` | function, interface | The base class the repository of your role entity extends, and what marks it as the one roles are read from |
| `ROLE_ENTITY`, `ROLE_REPOSITORY` | constant | Mark an entity and a repository as the ones of roles. `BaseRoleEntity` and `BaseRoleRepository` set them |
| `RoleLevel` | type | Where a role is held: `'tenant'` through a membership, `'platform'` by the user |
| `ZIBRI_DI_TOKENS.ROLE_SERVICE`, `RoleServiceInterface` | DI token, interface | Reads, creates, changes, deletes, gives and takes roles, see [managing roles](#managing-roles). Replaceable |
| `RoleCreateData`, `RoleUpdateData` | type | What a role is created with, and what of it changes |
| `RoleIdentity`, `WrittenRole` | type | What names a role, and a role as a write leaves it, as a `RoleServiceInterface` of your own takes them |
| `Auth.hasPermission`, `Auth.hasPlatformPermission` | decorator | A route only reachable when one of the caller's roles carries the permission, see [securing endpoints](./creating-endpoints.md#securing-endpoints) |
| `HasPermissionMetadata` | type | What both decorators declare, and what `auth.hasPermission` and `auth.hasPlatformPermission` of a manually registered route take |
| `CurrentUser` | type | The user a handler or a scope is handed: the user without their roles, with the `permissions` and `platformPermissions` the request may use |

## Declaring permissions
Name your permissions, and spread in Zibri's own:

```ts
// src/models/permissions.ts
import { DefinedPermissions, definePermissions, DefinedPlatformPermissions, definePlatformPermissions, PermissionDeclaration, ZIBRI_PERMISSIONS, ZIBRI_PLATFORM_PERMISSIONS } from 'zibri';

const PERMISSIONS = [...ZIBRI_PERMISSIONS, 'invoices.read', 'invoices.export'] as const;
const PLATFORM_PERMISSIONS = [...ZIBRI_PLATFORM_PERMISSIONS, 'tenants.manage'] as const;

export const Permissions: DefinedPermissions<typeof PERMISSIONS> = definePermissions(PERMISSIONS);
export const PlatformPermissions: DefinedPlatformPermissions<typeof PLATFORM_PERMISSIONS> = definePlatformPermissions(PLATFORM_PERMISSIONS);

export const permissions: PermissionDeclaration = {
    permissions: Object.values(Permissions),
    platformPermissions: Object.values(PlatformPermissions)
};
```

Each permission is named by its value in upper case, with every `.` and `-` turned into `_`: `Permissions.INVOICES_READ` is `'invoices.read'`. A permission is declared at one level, and once.

Provide the declaration to your application:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

import { permissions } from './models/permissions';

providers: [
    defineProvider({ token: ZIBRI_DI_TOKENS.PERMISSIONS, useValue: permissions })
]
```

A `Permission` and a `PlatformPermission` come from these two functions only. A plain string, or a permission of the other level, does not compile where one is asked for.

## Roles
A role is a row of your role entity. Extend `BaseRoleEntity`, with what you keep about a role besides, and declare it with `@Entity()`. Its repository extends `BaseRoleRepository`, declared with `@RepositoryFor` and listed in the `repositories` of the data source:

```ts
// src/models/role.model.ts
import { BaseRoleEntity, Entity, Property } from 'zibri';

@Entity()
export class Role extends BaseRoleEntity {
    @Property.string({ required: false })
    description: string | undefined | null;
}
```

```ts
// src/repositories/role.repository.ts
import { BaseRoleRepository, RepositoryFor } from 'zibri';

import { Role } from '../models/role.model';

@RepositoryFor(Role)
export class RoleRepository extends BaseRoleRepository<Role>() {}
```

Declare `Role` in the data source your users live in, next to `CacheInvalidation`. A role repository is required in an application with users, and an application has one. `BaseRoleEntity` and `BaseRoleRepository` mark their classes with `ROLE_ENTITY` and `ROLE_REPOSITORY`, which a role entity or repository of your own declares itself, the way [a user entity](./auth.md#creating-and-registering-user-models) does. A role's `name` is what users and memberships hold, unique across both levels. A tenant role carries tenant permissions, a platform role platform permissions. A role standing above another carries the other's permissions as well.

A role's `tenantId` is the tenant whose own role it is, and `null` for a role every tenant shares, which every platform role is. The role entity holds its tenant like any [entity of a tenant](./tenancy.md#declaring-the-tenant-of-an-entity) whose tenant is optional: outside every tenant its repository reads and writes the roles every tenant shares, inside a tenant it reads those and the tenant's own, and writes the tenant's own.

Users and memberships hold the names of roles, so type their entities without a role type of their own:

```ts
// src/models/user.model.ts
import { BaseUserEntity, Entity } from 'zibri';

@Entity({ tenant: 'shared' })
export class User extends BaseUserEntity() {}
```

```ts
// src/models/membership.model.ts
import { BaseMembershipEntity, Entity } from 'zibri';

@Entity({ uniques: [['userId']] })
export class Membership extends BaseMembershipEntity() {}
```

Seed the roles your application starts with through the repository, like the rest of your default data. Name them in enums to hand them out in code, such as to every new user:

```ts
// src/create-default-roles.function.ts
import { inject, RoleCreateData } from 'zibri';

import { MemberRoles } from './models/member-roles.enum';
import { Permissions, PlatformPermissions } from './models/permissions';
import { Role } from './models/role.model';
import { Roles } from './models/roles.enum';
import { RoleRepository } from './repositories/role.repository';

const defaultRoles: RoleCreateData<Role>[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: 'Everybody with an account' },
    { name: Roles.ADMIN, level: 'platform', permissions: Object.values(PlatformPermissions), description: 'Administers the application' },
    { name: MemberRoles.USER, level: 'tenant', permissions: [Permissions.INVOICES_READ], description: 'Everybody in a tenant' },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: Object.values(Permissions), description: 'Administers a tenant' }
];

export async function createDefaultRoles(): Promise<void> {
    const roleRepository: RoleRepository = inject(RoleRepository);
    const existing: Set<string> = new Set((await roleRepository.findAll({ take: 'all' })).map(role => role.name));
    await roleRepository.createAll(defaultRoles.filter(role => !existing.has(role.name)));
}
```

Every check reads the roles from memory: those every tenant shares from the start, and a tenant's own from the first check in that tenant that needs them, for as many tenants as fit. A tenant without roles of its own costs no read. A change to a role applies on the instance that made it at once, and on every other instance within a few seconds, through `CacheInvalidation`.

## Asking for a permission
| Decorator | Checks |
|---|---|
| `@Auth.hasPermission(permission)` | a tenant role of the user's membership in the tenant the request is for carrying the tenant permission |
| `@Auth.hasPlatformPermission(permission)` | a platform role of the user's own carrying the platform permission |

A route names one permission. A route that needs what two permissions allow gets a permission of its own:

```ts
// src/controllers/invoice.controller.ts
import { Auth, Controller, Get } from 'zibri';

import { Permissions } from '../models/permissions';

@Controller('/invoices')
export class InvoiceController {
    @Auth.hasPermission(Permissions.INVOICES_READ)
    @Get('/')
    async list(): Promise<unknown> {
        return [];
    }

    @Auth.hasPermission(Permissions.INVOICES_EXPORT)
    @Get('/export')
    async export(): Promise<unknown> {
        return {};
    }
}
```

The decorators work on a controller as well, and each has a `skip`, like every other [`@Auth` decorator](./creating-endpoints.md#securing-endpoints). A caller without the permission is answered `403`, and the refusal is recorded in the [audit trail](./logging.md) as `missing-permission`.

A [manually registered route](./auth.md#protecting-manually-registered-routes) states it as data:

```ts
// src/routes/report-export.route.ts
import { HttpMethod, inject, ZIBRI_DI_TOKENS } from 'zibri';

import { Permissions } from '../models/permissions';

inject(ZIBRI_DI_TOKENS.ROUTER).registerRoute({
    httpMethod: HttpMethod.GET,
    route: '/reports/export',
    auth: { hasPermission: { permission: Permissions.INVOICES_EXPORT } },
    handler: () => 'ok'
});
```

The OpenAPI document carries the permission of a route as `x-permission` and `x-platform-permission`.

## Managing roles
The `RoleService` creates, changes and deletes roles, and gives them to users and takes them away. Each of these takes the caller, the `CurrentUser` of the request, and checks what they may do:

| Method | Needs |
|---|---|
| `createRole`, `updateRole`, `deleteRole` of a role every tenant shares | `auth.create_role`, `auth.update_role`, `auth.delete_role` for a tenant role, `auth.create_platform_role`, `auth.update_platform_role`, `auth.delete_platform_role` for a platform role, as a platform permission |
| `createRole`, `updateRole`, `deleteRole` of a tenant's own role | `auth.create_tenant_role`, `auth.update_tenant_role`, `auth.delete_tenant_role`, as a tenant permission in the tenant the request acts in |
| `assignRole`, `unassignRole` of a platform role | `auth.assign_platform_role`, `auth.unassign_platform_role`, as a platform permission |
| `assignRole`, `unassignRole` of a tenant role | `auth.assign_role`, `auth.unassign_role`, as a tenant permission in the tenant the request acts in |

Each of them comes as `.with_any_permission`, for any role, and `.with_own_permissions`, for a role whose every permission the caller holds at its level. `updateRole` checks the role as it is and as it becomes. A caller who may not is answered `403`, recorded as `missing-permission`.

```ts
// src/controllers/role.controller.ts
import { Auth, Body, Controller, CurrentUser, Delete, inject, Param, Permission, PlatformPermission, Post, Property, Response, RoleLevel, ZIBRI_DI_TOKENS } from 'zibri';

import { Permissions, PlatformPermissions } from '../models/permissions';
import { Role } from '../models/role.model';
import { User } from '../models/user.model';

const ALL_PERMISSIONS: Readonly<Record<string, Permission | PlatformPermission>> = { ...Permissions, ...PlatformPermissions };

export class RoleRequest {
    @Property.string()
    name!: string;

    @Property.string({ enum: { tenant: 'tenant', platform: 'platform' } })
    level!: RoleLevel;

    @Property.array({ items: { type: 'string', enum: ALL_PERMISSIONS } })
    permissions!: (Permission | PlatformPermission)[];
}

@Auth.isLoggedIn()
@Controller('/roles')
export class RoleController {
    @Post('/')
    async create(@CurrentUser() user: CurrentUser<User>, @Body(RoleRequest) request: RoleRequest): Promise<Role> {
        return await inject(ZIBRI_DI_TOKENS.ROLE_SERVICE).createRole<Role>(user, { ...request, description: undefined }, undefined);
    }

    @Response.empty()
    @Post('/:name/holders/:userId')
    async assign(
        @CurrentUser() user: CurrentUser<User>,
        @Param.path('name') name: string,
        @Param.path('userId', { type: 'string', format: 'uuid' }) userId: string
    ): Promise<void> {
        await inject(ZIBRI_DI_TOKENS.ROLE_SERVICE).assignRole(user, userId, name, undefined);
    }

    @Response.empty()
    @Delete('/:name')
    async delete(@CurrentUser() user: CurrentUser<User>, @Param.path('name') name: string): Promise<void> {
        await inject(ZIBRI_DI_TOKENS.ROLE_SERVICE).deleteRole(user, name, undefined);
    }
}
```

A tenant role is given to a user's membership in the tenant the request acts in, a platform role to the user. `updateRole` changes the permissions and what you keep about a role, never its name, level or tenant. A role somebody holds is not deleted, and answers `400`: take it from everybody first. `findRoles` and `findRole` answer the roles the tenant the request acts in sees, the way the repository reads them.

Creating, changing, deleting, giving and taking a role is recorded as `auth.role.created`, `auth.role.updated`, `auth.role.deleted`, `auth.role.assigned` and `auth.role.unassigned`, with the `role`, the user it was given to or taken from as `subject`, and the caller as `userId`. Writing roles through the repository yourself, such as when seeding them, checks no caller and records nothing.

## A tenant's own roles
A tenant's administrator defines roles for their own tenant: seen, held and handed out in that tenant alone. Create one with the `tenantId` of the tenant the request acts in:

```ts
// src/services/reviewer-role.function.ts
import { CurrentUser, inject, ZIBRI_DI_TOKENS } from 'zibri';

import { Permissions } from '../models/permissions';
import { Role } from '../models/role.model';
import { User } from '../models/user.model';

export async function createReviewer(user: CurrentUser<User>, tenantId: string): Promise<Role> {
    return await inject(ZIBRI_DI_TOKENS.ROLE_SERVICE).createRole<Role>(
        user,
        { name: 'reviewer', level: 'tenant', permissions: [Permissions.INVOICES_READ], tenantId, description: 'Reads the invoices' },
        undefined
    );
}
```

Without a `tenantId`, the role is one every tenant shares. A role naming another tenant than the one the request acts in answers `403`.

A tenant's own role:

- is a tenant role, and carries any tenant permission the guard lets the caller give it
- is named apart from every role all tenants share, while two tenants can each have a role of one name, each carrying what its own tenant gave it
- is given and taken with `assignRole` and `unassignRole`, like a role every tenant shares
- is deleted once nobody in its tenant holds it

## What is checked
A declared permission no role carries is allowed. Nobody passes a route asking for it.

Every write of a role, however it is written, is checked: a permission that is not declared at the role's level answers `400`, and so do a platform role of a tenant, a tenant's own role named like a role every tenant shares, a role every tenant shares named like one a tenant has, and renaming a role somebody holds, moving it to the other level or another tenant, or deleting it. Writing the roles of a user or a membership checks every role exists: a user holds platform roles, a membership the tenant roles of its tenant. A role that does not exist there, or is of the other level, answers `400`, and nothing is written. A write that leaves the roles alone is not checked.

## In your own code
Your code asks for permissions, never for roles. The user a handler gets through `@CurrentUser()` is a `CurrentUser`: the user without their roles, with the permissions the request may use. `permissions` are those the roles of their membership in the tenant the request is for carry, `platformPermissions` those their own roles carry, both as far as the [credential](./api-keys.md#what-a-key-may-do) of the request may use them:

```ts
// src/controllers/me.controller.ts
import { Auth, Controller, CurrentUser, Get } from 'zibri';

import { Permissions } from '../models/permissions';
import { User } from '../models/user.model';

@Controller('/me')
export class MeController {
    @Auth.isLoggedIn()
    @Get('/')
    me(@CurrentUser() user: CurrentUser<User>): { email: string, mayExport: boolean } {
        return { email: user.email, mayExport: user.permissions.includes(Permissions.INVOICES_EXPORT) };
    }
}
```

`hasPermission` and `hasPlatformPermission` of the `AuthService` answer the same for the request being handled:

```ts
// src/services/may-export.function.ts
import { AuthServiceInterface, HttpRequestContext, inject, WebsocketRequestContext, ZIBRI_DI_TOKENS } from 'zibri';

import { Permissions } from '../models/permissions';

export async function mayExport(): Promise<boolean> {
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const request: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
    return request != undefined
        && await authService.hasPermission(request, authService.strategies, Permissions.INVOICES_EXPORT);
}
```

A permission they are asked for that is not declared at their level is carried by no role: the check answers no, and logs a warning the first time it is asked.

A [scope](./data-source.md#what-a-scope-is-told) asks the same with `hasPermission` and `hasPlatformPermission` of the context it is given, or reads the permissions of its `currentUser`.

The roles a user holds are data you read where they are stored. To find out whether somebody already holds a role in a tenant before giving it to them, read their membership:

```ts
// src/services/member-admin.function.ts
import { inject, ZIBRI_DI_TOKENS } from 'zibri';

import { MemberRoles } from '../models/member-roles.enum';
import { Membership } from '../models/membership.model';

export async function holdsMemberAdmin(userId: string, tenantId: string): Promise<boolean> {
    const membership: Membership | undefined = await inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE)
        .findMembership<string, Membership>(userId, tenantId);
    return membership?.roles.includes(MemberRoles.ADMIN) === true;
}
```

## Api keys
An [api key](./api-keys.md#what-a-key-may-do) lists the permissions it may use, and holds those of them its user's roles carry, so a key listing `Permissions.INVOICES_READ` cannot export even when its user is a `MemberRoles.ADMIN`. The `scope` of a token the [authorization server](./authorization-server.md#issuing-a-token) issues names permissions the same way.

## See also
- [Tenants](./tenancy.md) — memberships, and the tenant a request acts in
- [Authentication & authorization](./auth.md) — users, auth strategies and authenticators
- [Creating endpoints](./creating-endpoints.md#securing-endpoints) — securing endpoints with the `@Auth` decorators
- [API keys](./api-keys.md) — keys that use some of their user's permissions
- [Issuing tokens to services](./authorization-server.md) — the permissions a token's scope names