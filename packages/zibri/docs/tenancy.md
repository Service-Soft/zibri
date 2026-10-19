# Tenants
Every row your application stores belongs to one tenant, or is shared by all of them. Zibri keeps a
tenant's rows out of every other tenant's reach: each read and each write is narrowed to the tenant
the work is done for, whatever the code around it forgets to filter.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `EntityTenant` | type | What `@Entity({ tenant })` takes: `'shared'`, or the property holding the tenant id of each row |
| `TenantServiceInterface` | interface | `runAs` to do work as a tenant, `getActiveTenantId` to ask which tenant is active, `resolveTenant` to read the tenant of a request, `resolveTenantUrl` to put a tenant into a link |
| `TenantService` | class | Default implementation, reading the tenant of a request from its `x-tenant-id` header or query parameter |
| `ZIBRI_DI_TOKENS.TENANT_SERVICE` | DI token | Override to replace the implementation |
| `NoActiveTenantError` | error | Thrown when a tenant's rows are reached while no tenant is active |
| `BaseMembershipEntity`, `BaseMembership` | function, type | A user belonging to a tenant: `tenantId`, `userId`, the `roles` they hold there and when it was deactivated |
| `MembershipRepo` | decorator | Marks the class memberships are read from |
| `MembershipRepositoryInterface` | interface | What that class answers: `findMembership`, `findMemberships`, `resolveMembership`, `updateDeactivatedAt`, `deleteMembership`, `deleteMemberships` |
| `MembershipServiceInterface` | interface | Finds the memberships of a user, and follows every change to them |
| `ChangedMembership` | type | A user and a tenant whose membership was written |
| `MembershipService` | class | Default implementation, reading the class marked with `@MembershipRepo()` |
| `ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE` | DI token | Override to replace the implementation |

## Declaring the tenant of an entity
Every entity holds the tenant of each row in its uuid property `tenantId`:

```ts
// src/models/project.model.ts
import { BaseEntity, Entity, Property } from 'zibri';

@Entity()
export class Project extends BaseEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => Task, inverseSide: 'project' })
    tasks!: Task[];
}

@Entity()
export class Task extends BaseEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string()
    title!: string;

    @Property.manyToOne({ target: () => Project, joinColumn: 'projectId', inverseSide: 'tasks' })
    project!: Project;

    @Property.string({ format: 'uuid' })
    projectId!: string;
}
```

Or say that every tenant shares the rows:

```ts
// src/models/country.model.ts
import { BaseEntity, Entity, Property } from 'zibri';

@Entity({ tenant: 'shared' })
export class Country extends BaseEntity {
    @Property.string({ unique: true })
    code!: string;
}
```

To hold the tenant in another property, name it with `@Entity({ tenant: { property: 'workspaceId' } })`.
An entity without its tenant property, that is not shared, does not compile. The tenant property is
a plain `@Property.string({ format: 'uuid' })`: it cannot be encrypted, hashed or the primary key,
and an application declaring it any other way does not start.

When the tenant property is `required: false`, a row may also belong to no tenant. Such a row is
seen by every tenant, while a row with a tenant is seen by that tenant only:

```ts
// src/models/announcement.model.ts
import { BaseEntity, Entity, Property } from 'zibri';

@Entity()
export class Announcement extends BaseEntity {
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;

    @Property.string()
    text!: string;
}
```

## The active tenant
Work reaches the rows of the tenant that is active while it runs. Make a tenant active with `runAs`:

```ts
import { inject, Repository, repositoryTokenFor, TenantServiceInterface, ZIBRI_DI_TOKENS } from 'zibri';

async function nameProjects(tenantId: string): Promise<string[]> {
    const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    const projects: Repository<Project> = inject(repositoryTokenFor(Project));
    return await tenants.runAs(tenantId, async () => (await projects.findAll({ take: 'all' })).map(p => p.name));
}
```

Everything inside it reaches that tenant's rows, however deep the calls go. `runAs` inside another
`runAs` replaces the tenant until the inner work is done. A tenant id is a uuid, and `runAs` refuses
any other value. It names the tenant in either case, and `getActiveTenantId` answers it in lower case.

With no tenant active, reading or writing an entity whose rows all belong to a tenant throws a
`NoActiveTenantError`, and in a request answers `400`. An entity whose tenant is optional answers
with the rows that belong to no tenant.

## The tenant of a request
Every http request and every websocket message acts in the tenant it names, which
`TenantService.resolveTenant` reads from it. By default that is the `x-tenant-id` header:

```
GET /projects HTTP/1.1
x-tenant-id: 3f0c1d52-8b6e-4c55-9a4f-2d1e7b9c4a10
```

A websocket message sends the header among its own headers, `{ headers: { 'x-tenant-id': '…' }, body }`.
A link names its tenant in the query instead, `?x-tenant-id=…`, since following a link sends no
header. A request whose header and query name different tenants answers `400`. `resolveTenantUrl`
puts a tenant into a link:

```ts
import { inject, TenantServiceInterface, ZIBRI_DI_TOKENS } from 'zibri';

async function invitationLink(tenantId: string, token: string): Promise<string> {
    const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    return await tenants.resolveTenantUrl(`https://api.example.com/invitations/${token}`, tenantId);
}
```

A request naming no tenant, sent with a credential bound to one, such as an
[api key bound to a tenant](./api-keys.md), acts in that tenant. Any other request naming no tenant
reaches only what every tenant shares, such as logging in. A request naming a tenant that is not a
uuid answers `400`, also when your own `resolveTenant` reads it.

To read the tenant from somewhere else, provide a `TenantService` of your own that overrides
`resolveTenant`, and `resolveTenantUrl` beside it so that links name the tenant the same way.
`resolveTenant` gets the http request or the websocket message, so it says for both where their
tenant comes from:

```ts
// src/services/subdomain-tenant.service.ts
import { HttpRequest, inject, Repository, repositoryTokenFor, TenantService, WebsocketRequest } from 'zibri';

import { Tenant } from '../models/tenant.model';

export class SubdomainTenantService extends TenantService {
    override async resolveTenant(request: HttpRequest | WebsocketRequest): Promise<string | undefined> {
        const host: unknown = request.headers?.host;
        const subdomain: string | undefined = typeof host === 'string' ? host.split('.')[0] : undefined;
        return subdomain == undefined ? undefined : await this.findTenantIdBySubdomain(subdomain);
    }

    override async resolveTenantUrl(url: string, tenantId: string): Promise<string> {
        const tenants: Repository<Tenant> = inject(repositoryTokenFor(Tenant));
        const link: URL = new URL(url);
        link.hostname = `${(await tenants.findById(tenantId)).subdomain}.${link.hostname}`;
        return link.toString();
    }

    private async findTenantIdBySubdomain(subdomain: string): Promise<string | undefined> {
        const tenants: Repository<Tenant> = inject(repositoryTokenFor(Tenant));
        return (await tenants.findOne({ where: { subdomain }, required: false }))?.id;
    }
}
```

```ts
// src/providers.ts
import { DiProvider, ZIBRI_DI_TOKENS } from 'zibri';

export const providers: DiProvider<unknown>[] = [
    { token: ZIBRI_DI_TOKENS.TENANT_SERVICE, useClass: SubdomainTenantService }
];
```

A request without a logged in user acts in the tenant it names, and the [`@Auth`
decorators](./creating-endpoints.md#securing-endpoints) of the route decide whether it may. A logged
in user acts in a tenant only through their membership in it: a request of theirs for a tenant they
are no member of answers `403`, on every route.

## Members and their roles
A user belongs to the tenants they have a membership in. Declare the membership entity and the class
it is read from, next to your user:

```ts
// src/models/membership.model.ts
import { BaseMembershipEntity, Entity } from 'zibri';

import { Role } from './role.enum';

// one membership per user in each tenant
@Entity({ uniques: [['userId']] })
export class Membership extends BaseMembershipEntity(Role) {}
```

```ts
// src/repositories/membership.repository.ts
import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook, Inject, InjectRepository, LoggerInterface, MembershipRepo, MembershipRepositoryInterface, Repository, Transaction, ZIBRI_DI_TOKENS } from 'zibri';

@MembershipRepo()
export class MembershipRepository extends Repository<Membership> implements MembershipRepositoryInterface<Role, Membership> {
    constructor(
        @InjectRepository(Membership)
        repo: Repository<Membership>,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        logger: LoggerInterface
    ) {
        super(Membership, repo, logger, repo.dataSource, getDefaultBeforeSaveHook(), getDefaultBeforeReturnHook());
    }

    async findMembership(userId: string): Promise<Membership | undefined> {
        return await this.findOne({ where: { userId }, required: false });
    }

    async findMemberships(userId: string): Promise<Membership[]> {
        return await this.findAll({ where: { userId }, acrossTenants: true });
    }

    async resolveMembership(userId: string, transaction: Transaction | undefined): Promise<Membership> {
        return await this.findOne({ where: { userId }, transaction, required: false })
            ?? await this.create({ userId, roles: [] }, { transaction });
    }

    async updateDeactivatedAt(userId: string, deactivatedAt: Date | null, transaction: Transaction | undefined): Promise<void> {
        await this.updateAll({ userId }, { deactivatedAt }, { transaction });
    }

    async deleteMembership(userId: string, transaction: Transaction | undefined): Promise<void> {
        await this.deleteAll({ userId }, { transaction });
    }

    async deleteMemberships(userIds: string[], transaction: Transaction): Promise<void> {
        await this.deleteAll({ userId: { oneOf: userIds } }, { transaction, acrossTenants: true });
    }
}
```

An application with users and no class marked with `@MembershipRepo()` does not start.

Deleting a user deletes their memberships in every tenant, in the same transaction, however the user
is deleted. A soft deleted user keeps them.

A membership whose `deactivatedAt` is set counts as none: every request of the user for that tenant
answers `403`, and `findMembership` and `findMemberships` of the `MembershipService` leave it out.
It keeps its roles, so setting `deactivatedAt` back to `null` returns the user to the tenant as they
were.

A route asks for a role in one of two ways:

| Decorator | Checks |
|---|---|
| `@Auth.hasRole(roles)` | the roles of the user's membership in the tenant the request is for |
| `@Auth.hasPlatformRole(roles)` | the roles of the user's own, independent of the tenant, eg. for operating the whole application |

A platform role never makes a user a member of a tenant. Work across tenants is code that passes
[`acrossTenants`](#reaching-every-tenant), behind `@Auth.hasPlatformRole`.

A [scope](./data-source.md#restricting-which-rows-a-caller-may-see) gets the `tenantId` and the
`currentMembership` of the request next to the `currentUser`, and `AuthService.getCurrentMembership`
answers the membership a request acts through.

## What is narrowed
Every repository call on a tenant's entity is narrowed to the active tenant:

- a read finds the tenant's rows and no others, and a row of another tenant is answered with a
  `404`, the same as a row that does not exist
- a new row gets the active tenant, and a new row naming another tenant is refused with a `403`
- an update or delete reaches the tenant's rows only
- a row's tenant never changes: an update setting the tenant property to anything else is refused with
  a `403`

On an entity whose tenant is optional, a tenant reads the rows of no tenant and does not change
them. Updating or deleting one by its id answers `403`, and updating or deleting several rows leaves
them out. Change them [across tenants](#reaching-every-tenant).

`unscoped` lifts an entity's [scopes](./data-source.md#restricting-which-rows-a-caller-may-see) and
leaves the tenant in place. A tenant is narrowed by first, and a scope narrows within it.

## Uniques and indexes
On a tenant's entity, every unique holds within each tenant: two tenants can each have a project
named `Website`, and one tenant cannot have two. Every index starts with the tenant property, which
is what answers a lookup by the tenant alone; an entity declaring no index and no unique gets an index
on the tenant property.

On an entity whose tenant is optional, the rows of no tenant are unique among themselves, the same
way each tenant's rows are.

A unique group that names the tenant property already is kept as it is written:

```ts
// src/models/tenant-settings.model.ts
import { BaseEntity, Entity, Property } from 'zibri';

// one row of settings per tenant
@Entity({ uniques: [['tenantId']] })
export class TenantSettings extends BaseEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string()
    locale!: string;
}
```

An [`upsert`](./data-source.md#changing-a-value-based-on-what-is-stored--upsert) finds the row of the
active tenant: its identity is unique together with the tenant.

## Relations
A row only points at rows of its own tenant, and a shared row only at shared rows. Every write
checks it, however it sets the relation - by a related row, by its id or by the column holding the
id. A row pointing at a row of another tenant, or at one that is not there, is refused with a `403`.

Related rows created together with a row get its tenant:

```ts
async function createProject(projects: Repository<Project>): Promise<Project> {
    // every task gets the tenant of the project
    return await projects.create({ name: 'Website', tasks: [{ title: 'Design' }, { title: 'Build' }] });
}
```

A relation between an entity whose rows all belong to a tenant and a shared entity is refused when
the application starts, since no row could ever be written through it. Keep the id of the shared row
in a column of its own instead, eg. a simple `userId` string rather than a whole `user` relation.

## Reaching every tenant
Work that serves every tenant at once - a job draining a queue, a report across tenants - passes
`acrossTenants` to the call:

```ts
async function countProjects(projects: Repository<Project>): Promise<number> {
    return await projects.count({ acrossTenants: true });
}
```

A row created across tenants names its tenant in its data, or `null` for a row of no tenant where
the tenant is optional. Each use of `acrossTenants` is a place the restriction does not hold, so it
is written at the call rather than configured anywhere.

## Work outside a request
What starts in a tenant stays in it, wherever it is picked up later:

| What | Belongs to |
|---|---|
| An [event](./events.md) | The tenant it was emitted in. Its subscribers run in that tenant |
| A queued [thread job](./multithreading.md) | The tenant it was queued in |
| A queued [email](./email.md) | The tenant it was queued in |
| A [log entry](./logging.md) | The tenant it was logged in |
| A [change set](./data-source.md#changesetrepository) | The tenant of the row it describes |
| A [websocket](./websocket.md#tenants) channel or message | The tenant it was created or sent in |
| A [cache](./caching.md) entry | The tenant active while it is read or written |

Each of them carries its tenant in `tenantId`, and is seen by that tenant only. One started outside
every tenant is seen by every tenant. What runs for one of them runs in its tenant: the hooks of an
event, the callbacks of a thread job and the transport sending a mail.

A [cron job](./cron.md) runs outside every tenant. To do work for a tenant in it, use `runAs`, and
use `acrossTenants` to do work for all of them.