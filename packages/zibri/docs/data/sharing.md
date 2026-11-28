---
keywords: [share, row level security, row level access, guests, customers, access control list, acl, per row permissions]
---

# Sharing rows with selected people
A shareable entity lets you share single rows with chosen members of a [tenant](../glossary.md#tenant), such as one
project with the customer it is for. A member whose role carries the permission you name sees every row, as without
sharing. Everybody else sees only the rows shared with them and the rows below those, in the role each share grants.
The rows are narrowed like a [scope](../glossary.md#scope) narrows them, by every repository call, so a list, a page,
a relation or a filter shows a guest what is shared with them and nothing else.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `EntityShareable` | type | What `shareable` of `@Entity` takes: the `fullAccess` permission, the `parent` relation and the `roles` |
| `ZIBRI_DI_TOKENS.SHARE_SERVICE`, `ShareServiceInterface` | DI token, interface | Shares and unshares rows, answers roles and what a caller sees. Replaceable |
| `ShareService` | class | Keeps the shares in `RowShare`. Replaceable through `ZIBRI_DI_TOKENS.SHARE_SERVICE` |
| `Auth.requireShareRole` | decorator | A route only reachable with a role on the row a path parameter names, or with full access |
| `RowShare` | entity | A row shared with a user in a role |
| `RowShareCreateData` | type | What a share is created with |
| `ShareInvitationData`, `ShareByEmailResult` | type, type | The invitation `shareByEmail` sends to an email without a [membership](../glossary.md#membership), and what it did |
| `RowShareGrant`, `PendingRowShare` | type, class | A row an invitation shares, as `invite` takes it in `rowShares`, and as the invitation stores it |
| `RequireShareRoleFn`, `RequireShareRoleMetadata` | type, type | The type of `Auth.requireShareRole`, and what it declares, as `auth.requireShareRole` of a manually registered route takes it |

## Declaring a shareable entity
Declare `shareable` on the entity, with the permission that shows every row and the roles a share grants, from the
least to the most:

```ts
// src/models/project.model.ts
import { BaseTenantEntity, Entity, Property } from 'zibri';

import { Permissions } from './permissions';
import { ProjectTask } from './project-task.model';

@Entity({
    shareable: {
        fullAccess: Permissions.PROJECTS_READ,
        parent: 'parent',
        roles: ['viewer', 'commenter', 'editor']
    }
})
export class Project extends BaseTenantEntity() {
    @Property.string()
    name!: string;

    @Property.string({ format: 'uuid', required: false })
    parentId?: string | null;

    @Property.manyToOne({ target: () => Project, joinColumn: 'parentId', inverseSide: 'children', required: false })
    parent?: Project;

    @Property.oneToMany({ target: () => Project, inverseSide: 'parent', required: false })
    children?: Project[];

    @Property.oneToMany({ target: () => ProjectTask, inverseSide: 'project', required: false })
    tasks?: ProjectTask[];
}
```

| Option | What it is |
|---|---|
| `fullAccess` | The tenant permission that shows every row, or `{ permission, platformPermission }`, either of which is enough, answered as [`@Auth.hasAnyLevelPermission`](../auth/roles-and-permissions.md#accepting-a-permission-of-either-level) answers them. Required |
| `parent` | The `manyToOne` or `belongsToOne` relation of the entity to itself. A row shared with somebody shares every row below it, to any depth. No parent by default, so each row is shared on its own |
| `roles` | The roles a share grants, from the least to the most. Required |

A guest is a member whose tenant roles do not carry `fullAccess`, such as a role `guest` with no permissions. Nothing
else marks them. The entity belongs to a tenant, and a share is held in that tenant.

For a guest, every repository call on the entity is narrowed the way a
[scope](./data-source.md#restricting-which-rows-a-caller-may-see) narrows it:

- A row they do not see is answered `404` by `findById`, and is left out of every list, page and count.
- A relation holds the rows they see: `children` holds the rows below, and `parent` is `undefined` above a shared row.
- A row created or moved outside what they see is refused with a `403`. A row created below a row they see is one they
  see, at once.
- A `scope` of the entity's own applies as well: a guest sees the rows both let through.

Code outside a request sees no row either, and reads past the restriction with `unscoped: true`, which lifts every
scope of the entity at once.

A write placing a row below itself or below a row under it is refused with a `400`.

## Narrowing the rows that belong to a shared row
A task belongs to the project it is on, and is seen by whoever sees the project. Declare `sharedThrough` with the
`manyToOne` or `belongsToOne` relation to that row:

```ts
// src/models/project-task.model.ts
import { BaseTenantEntity, Entity, Property } from 'zibri';

import { Project } from './project.model';

@Entity({ sharedThrough: 'project' })
export class ProjectTask extends BaseTenantEntity() {
    @Property.string()
    title!: string;

    @Property.string({ format: 'uuid' })
    projectId!: string;

    @Property.manyToOne({ target: () => Project, joinColumn: 'projectId', inverseSide: 'tasks' })
    project!: Project;
}
```

A guest sees the tasks of the projects they see, and creates a task only on one of those. The relation may lead to an
entity shared through a relation in turn: a comment declaring `sharedThrough: 'task'` is seen by whoever sees the
project of its task. Each entity names its own step, as many as the rows need, and the steps end at a shareable
entity. `fullAccess` is the one of that entity.

## Sharing a row
Share a row with a member of the tenant through the `ShareService`. Sharing it again changes the role:

```ts
// src/services/project-sharing.service.ts
import { inject, RowShare, ShareServiceInterface, ZIBRI_DI_TOKENS } from 'zibri';

import { Project } from '../models/project.model';

export async function shareProject(projectId: string, userId: string): Promise<RowShare> {
    const shareService: ShareServiceInterface = inject(ZIBRI_DI_TOKENS.SHARE_SERVICE);
    return await shareService.share(Project, projectId, userId, 'commenter', undefined);
}

export async function stopSharingProject(projectId: string, userId: string): Promise<void> {
    const shareService: ShareServiceInterface = inject(ZIBRI_DI_TOKENS.SHARE_SERVICE);
    await shareService.unshare(Project, projectId, userId, undefined);
}
```

| Method | What it does |
|---|---|
| `share` | Shares a row of the active tenant with a member of it, in a role the entity declares. A role it does not declare, and a user who is no active member, answer `400`, a row the tenant does not hold `404` |
| `unshare` | Stops sharing a row with a user. They see nothing of it from their next request on |
| `findShares` | The shares of a row itself, without those of the rows above it |
| `findSharesOfUser` | Every share of a user in the active tenant |
| `resolveRole` | The role a user holds on a row: the highest along the row and the rows above it, `undefined` for none |

The service decides nothing about who may share. A route of yours does, such as one requiring the `editor` role.

## Sharing a row by email
`shareByEmail` shares a row with the member of the tenant the email belongs to. An email without a membership in the
tenant gets an [invitation](../auth/invitations.md) into it, with the guest roles you name, which creates the share
once it is accepted:

```ts
// src/controllers/project-share.controller.ts
import { Auth, Body, Controller, CurrentUser, inject, Param, Post, Property, ShareByEmailResult, ZIBRI_DI_TOKENS } from 'zibri';

import { Invitation, MemberRoles, Permissions, User } from '../models';
import { Project } from '../models/project.model';

export class ShareProjectRequest {
    @Property.string({ format: 'email' })
    email!: string;

    @Property.string()
    name!: string;
}

@Controller('/projects')
export class ProjectShareController {
    @Auth.hasPermission(Permissions.PROJECTS_READ)
    @Post('/:id/shares')
    async share(
        @CurrentUser() user: CurrentUser<User>,
        @Param.path('id', { type: 'string', format: 'uuid' }) id: string,
        @Body(ShareProjectRequest) request: ShareProjectRequest
    ): Promise<ShareByEmailResult<Invitation>> {
        return await inject(ZIBRI_DI_TOKENS.SHARE_SERVICE).shareByEmail<Invitation>(user, Project, id, request.email, 'commenter', {
            name: request.name,
            roles: [MemberRoles.GUEST],
            createOn: 'accept',
            declinable: true,
            expiresInMs: undefined,
            withoutPassword: true
        }, undefined);
    }
}
```

The invitation takes what `invite` takes beside the email and the tenant, the guest `roles` among them, and is checked
like any other: the caller needs to be allowed to hand the roles out. With `withoutPassword: true` the guest logs in
with a link, see [accepting without a password](../auth/invitations.md#accepting-without-a-password). Accepting
creates the account, the membership and the share in one transaction.

`invite` takes the rows to share itself as well, in `rowShares`, each a `RowShareGrant` of the entity, the id of the
row and the role. The invitation keeps them until it is accepted.

## Requiring a role
`@Auth.requireShareRole` lets a request through when the caller has `fullAccess`, or holds at least the role on the
row the path parameter names:

```ts
// src/controllers/project-comment.controller.ts
import { Auth, Controller, Param, Post, Response } from 'zibri';

import { Project } from '../models/project.model';

@Controller('/projects')
export class ProjectCommentController {
    @Auth.requireShareRole(Project, 'commenter', 'id')
    @Response.empty()
    @Post('/:id/comments')
    async comment(@Param.path('id', { type: 'string', format: 'uuid' }) id: string): Promise<void> {
        await Promise.resolve(id);
    }
}
```

A role is held on a row through a share of it or of a row above it, and the highest of those counts: an editor of a
project below one shared with them as a viewer edits it. A caller who does not see the row is answered `404`, one
with a lower role `403`, recorded in the audit trail as `missing-permission`. The entity may be one shared through a
relation, such as `ProjectTask`, whose role is the one on its project. The decorator works on a controller as well,
and a route naming a role the entity does not declare is refused when the application starts.

In a handler, `validateRole` checks the same for the request:

```ts
// src/services/project-edit.service.ts
import { inject, ZIBRI_DI_TOKENS } from 'zibri';

import { Project } from '../models/project.model';

export async function validateMayEdit(projectId: string): Promise<void> {
    await inject(ZIBRI_DI_TOKENS.SHARE_SERVICE).validateRole(Project, projectId, 'editor');
}
```

## Showing other people to a guest
A guest sees other users by their name, never by their email address. Answer a user to a caller without
`fullAccess` as a `SharedUserModel` of `zibri-contract`, `{ id, name }`, and ask `resolveHasFullAccess` which one the
caller is:

```ts
// src/services/assignee.service.ts
import { inject, ZIBRI_DI_TOKENS } from 'zibri';

import { Project } from '../models/project.model';

export type Assignee = {
    id: string,
    name: string,
    email?: string
};

export async function toAssignee(user: Required<Assignee>): Promise<Assignee> {
    const fullAccess: boolean = await inject(ZIBRI_DI_TOKENS.SHARE_SERVICE).resolveHasFullAccess(Project);
    return fullAccess ? user : { id: user.id, name: user.name };
}
```

The guest role carries no permission that reads users, so the routes reading them stay closed to a guest.

## When a share ends
| What happens | What the share does |
|---|---|
| `unshare` | Ends, and the user sees nothing of the row from their next request on |
| The last share of a user ends | The account and the membership stay, and the user sees no row |
| The row is deleted | Its shares are deleted in the same transaction, and those of the rows deleted along with it |
| The row is [soft deleted](../glossary.md#soft-delete) | Stays, and counts again once the row is restored |
| The user is deleted for good | Every share of theirs is deleted, in every tenant |

## What sharing costs
What a guest sees is read once per request and entity: one read of their shares, one read per level of rows below
those, and one per step of `sharedThrough` on the way to the shareable entity. Every repository call of the request
reuses it, until a write of the request to a share or to one of the entities changes it. A caller with `fullAccess`
costs nothing beyond the permission check. Each call is narrowed by the ids of the rows the guest sees, so a guest
sharing thousands of rows sends thousands of ids with every query.

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `RowShare` | An entity declares `shareable` |

Declare `RowShare` in the data source your users and your shareable entities live in: a share is deleted in the
transaction that deletes its row or its user.

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Data sources](./data-source.md#restricting-which-rows-a-caller-may-see) — scopes, which sharing narrows rows like
- [Tenants](./tenancy.md#members-and-their-roles) — memberships, which a share is held through
- [Roles and permissions](../auth/roles-and-permissions.md) — the permission that shows every row
- [Inviting people](../auth/invitations.md) — the invitation sharing by email sends
- [Logging in with a link](../auth/login-links.md) — how a guest without a password logs in
