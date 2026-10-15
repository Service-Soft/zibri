# Provisioning through SCIM
A tenant's identity provider, such as Entra ID, Okta, Google or Keycloak, makes its people members of the [tenant](./tenancy.md) before they first sign in, keeps them up to date, gives them roles there through its groups, and takes their access away the moment they leave. It does so through SCIM, a set of routes your application offers and the identity provider of each tenant calls.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ScimController` | function | Defines the SCIM routes, for a controller of yours to extend |
| `ScimControllerOptions`, `ScimBulkOptions` | type | Who may provision, and how much one bulk request may do |
| `BaseScimProvisioner` | class | Extend it to say what provisioning does to your users |
| `ScimUserResource` | type | A user as the identity provider provisions it |
| `ScimGroupResource` | type | A group as the identity provider provisions it |
| `ScimUser`, `ScimUserValue`, `ScimGroup`, `ScimGroupMember` | entity | The users and groups each tenant's identity provider provisioned, the values filters find users by, and who is a member of which |
| `ScimMemberType` | enum | Whether a member of a group is a user or a group |
| `ScimError` | class | An error answered the way SCIM says errors look |
| `ZIBRI_DI_TOKENS.SCIM_SERVICE` | DI token | The service answering the SCIM routes, replaceable |
| `ScimServiceInterface`, `ScimEndpoint`, `ScimResourceResponse` | type | What a service of your own implements, and what it is handed and answers |

## Setting it up
Declare `ScimUser`, `ScimUserValue`, `ScimGroup` and `ScimGroupMember` in the data source your users live in, next to `ApiKey` and your [memberships](./tenancy.md#members-and-their-roles), and register `ApiKeyAuthStrategy`: the identity provider calls the routes with an [api key](./api-keys.md).

Then extend `BaseScimProvisioner`:

```ts
// src/auth/company.scim-provisioner.ts
import { BaseScimProvisioner, inject, Repository, repositoryTokenFor, ScimGroupResource, ScimUserResource, Transaction } from 'zibri';

import { Membership } from '../models/membership.model';
import { Role } from '../models/role.enum';
import { User } from '../models/user.model';

export class CompanyScimProvisioner extends BaseScimProvisioner<Role, User, Membership> {
    private get users(): Repository<User> {
        return inject(repositoryTokenFor(User));
    }

    private get memberships(): Repository<Membership> {
        return inject(repositoryTokenFor(Membership));
    }

    async findProvisionedUser(resource: ScimUserResource, transaction: Transaction): Promise<User | undefined> {
        return await this.users.findOne({ where: { email: resource.userName.toLowerCase() }, transaction, required: false });
    }

    async createProvisionedUser(resource: ScimUserResource, transaction: Transaction): Promise<User> {
        return await this.users.create({ email: resource.userName.toLowerCase(), roles: [] }, { transaction });
    }

    async resolveUpdatedUser(resource: ScimUserResource, user: User, transaction: Transaction): Promise<void> {
        await this.users.updateById(user.id, { email: resource.userName.toLowerCase() }, { transaction });
    }

    async resolveGroupMembership(membership: Membership, groups: ScimGroupResource[], transaction: Transaction): Promise<void> {
        const roles: Role[] = groups.some(group => group.displayName === 'App Admins') ? [Role.USER, Role.ADMIN] : [Role.USER];
        await this.memberships.updateById(membership.id, { roles }, { transaction });
    }

    async resolveDeletedUser(user: User, transaction: Transaction): Promise<void> {
        await this.users.deleteById(user.id, { transaction });
    }
}
```

Define the routes with it, below the path you give them:

```ts
// src/controllers/scim.controller.ts
import { Controller, ScimController } from 'zibri';

@Controller('/scim/v2')
export class CompanyScimController extends ScimController(CompanyScimProvisioner, { roles: [Role.PROVISIONING] }) {}
```

`roles` are the roles the identity provider's user holds in the tenant, one of them at least. Give each tenant's identity provider a user of its own, a [service account](./api-keys.md#service-accounts) that is a member of the tenant with a role for provisioning and nothing else, and create an api key for it bound to the tenant.

At the identity provider, enter the url of the routes, eg. `https://api.example.com/scim/v2`, as the tenant url, and the api key as the secret token. It sends the key as a bearer token, and every request of it acts in the tenant the key is bound to. The url of every resource starts with your application's `baseUrl` followed by the path of the controller, so set `baseUrl` to the url the identity provider reaches.

The application refuses to start when it declares a SCIM controller without the four entities or without `ApiKeyAuthStrategy`.

## The routes
| Route | What it does |
|---|---|
| `POST /Users` | Provisions a user, answers `201` |
| `GET /Users` | Finds users, see [finding resources](#finding-resources) |
| `GET /Users/:id` | Answers a user |
| `PUT /Users/:id` | Replaces a user |
| `PATCH /Users/:id` | Changes a user |
| `DELETE /Users/:id` | Deletes a user, answers `204` |
| `POST`, `GET`, `PUT`, `PATCH`, `DELETE` below `/Groups` | The same for groups |
| `POST /Bulk` | Applies several of the above in one request, see [bulk requests](#bulk-requests) |
| `GET /ServiceProviderConfig` | What the routes support |
| `GET /ResourceTypes`, `GET /ResourceTypes/:id` | Users and groups |
| `GET /Schemas`, `GET /Schemas/:id` | The attributes of users, of the enterprise extension and of groups |

They answer in `application/scim+json`, or in `application/json` for a client that asks for it, and read either.

## Versions
Every user and group answers with its url in `meta.location` and its version in `meta.version`, eg. `W/"3"`, and a route answering with one resource sends both as the `Location` and `ETag` headers. Every change makes a new version.

A `GET` whose `If-None-Match` names the version the resource still has answers `304` without a body. A `PUT`, `PATCH` or `DELETE` whose `If-Match` names versions is applied only while the resource has one of them, and answers `412` otherwise. `If-Match: *` allows any version. Of two changes to the same resource at once, one is applied and the other answers `409`, or `412` when it named a version.

## What a provisioned user is
Every user the identity provider provisions goes to `findProvisionedUser` first, which answers the user of your application it stands for, such as one with that email, or undefined. For undefined, `createProvisionedUser` creates the user. The SCIM resource is linked to that user, who becomes a member of the tenant. A tenant's identity provider sees the users it provisioned and no others: two tenants provisioning the same person each keep a resource of their own.

A user the identity provider created is owned by its tenant. Its identity provider changes, deactivates and deletes that user everywhere: every change of their resource is handed to `resolveUpdatedUser`. A user it found, who existed already and may belong to other tenants, is only a member of its tenant: its identity provider reaches their membership there and nothing else about them.

`ScimUserResource` holds the `userName`, the `externalId` the identity provider gave the user, whether they are `active`, and every other attribute it sent under `attributes`: `name`, `displayName`, `emails`, the enterprise extension under `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User`, and whatever else it is set up to send. A `password` is never kept.

Two users of a tenant cannot share a `userName`, whatever its case: the second is refused with a `409`.

## Deactivating and deleting
| The identity provider | A user its tenant owns | Any other user |
|---|---|---|
| sets them inactive | [deactivated](./auth.md#deactivating-a-user): their logins end, their api keys are revoked, and they cannot log in until it sets them active again | their membership in the tenant is [deactivated](./tenancy.md#members-and-their-roles) until it sets them active again |
| deletes them | deactivated, then handed to `resolveDeletedUser`, which deletes them or keeps them deactivated, eg. anonymized | their membership in the tenant is deleted |

A user provisioned inactive is deactivated from the start, as far as the tenant reaches. A deleted user's resource, group memberships and membership in the tenant are gone either way. Deleting a user deletes their memberships in every tenant, so a person who leaves the company owning them loses every tenant they were a member of, such as one of a customer.

A user your application deletes on its own, such as from an admin page, is gone for the identity provider as well: their resource is not listed or found anymore, and the identity provider provisions them anew the next time it sends them.

## Groups and roles
`resolveGroupMembership` gets the user's membership in the tenant and every group they are a member of now, once they are provisioned and whenever their groups change: a member added or removed, a group renamed or deleted. Answer it by setting the roles of the membership from the groups, or leave roles to your application.

A member of a group is a user or a group the identity provider provisioned. A group naming anything else is refused with a `400`. A user in a group that is a member of another group is a member of both, so `resolveGroupMembership` gets every group a user is in, directly or through groups inside groups, as deep as they go.

A user answers with the same groups in `groups`, each with `type` `direct` or `indirect`. The identity provider cannot set them: `groups` it sends on a user is ignored.

## Finding resources
`GET /Users` and `GET /Groups` take a `filter`, joined by `and`, `or` and `not`, and grouped with parentheses:

| Resource | Attributes |
|---|---|
| User | every attribute it was provisioned with, such as `userName`, `name.familyName`, `emails.value` or `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:employeeNumber`, and `id`, `meta.created`, `meta.lastModified`, `groups.value` and `groups.display` |
| Group | `id`, `displayName`, `externalId`, `members.value`, `meta.created`, `meta.lastModified` |

Each compares with the operators its type has:

| Attribute | Operators |
|---|---|
| text, such as `userName`, `displayName`, `externalId` or `title` | `eq`, `ne`, `co`, `sw`, `ew`, `gt`, `ge`, `lt`, `le`, `pr` |
| numbers, `meta.created`, `meta.lastModified` | `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `pr` |
| true or false, such as `active`, and `id` | `eq`, `ne`, `pr` |
| `groups.value`, `groups.display` of a user | the operators of `id` and `displayName` of a group |
| `members.value` of a group, also as `members[value eq "…"]` | `eq` |

Text is compared without regard to case, except `externalId`. An attribute with several values, such as `emails`, matches when one of them does, and `emails eq "…"` compares their `value`. In brackets, every comparison is about the same value: `emails[type eq "work" and value ew "@example.com"]` finds users whose work address is at example.com, not users with any work address and any address at example.com. `groups.value` and `groups.display` find a user through the groups they are in, directly or through groups inside groups.

A filter asking for something else, such as `meta.version` or `groups.type`, is refused with a `400` and `scimType: invalidFilter`.

`sortBy` sorts users by any attribute a filter compares, except `groups`, and groups by the attributes above except `members.value`. An attribute with several values sorts by its primary value, or else its first one. `sortOrder` says `ascending` or `descending`. Resources without a value of the attribute come last when ascending and first when descending. Without `sortBy`, resources come in the order they were provisioned.

A list answers at most 200 resources, from `startIndex` (counting from 1) and as many as `count`. `attributes` names the attributes to answer with and `excludedAttributes` the ones to leave out, such as `members` of a group.

## Bulk requests
`POST /Bulk` applies a list of operations one after the other, each answered as its own request would be:

```json
{
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"],
    "Operations": [
        { "method": "POST", "path": "/Users", "bulkId": "anna", "data": { "userName": "anna@example.com" } },
        { "method": "POST", "path": "/Groups", "data": { "displayName": "Sales", "members": [{ "value": "bulkId:anna" }] } }
    ]
}
```

An operation refers to a resource another one of the request creates as `bulkId:` followed by its `bulkId`, and is applied once that one is, wherever it stands in the list. Of operations referring to each other in a circle, such as two groups each a member of the other, the first creating a resource is applied without what refers to the others, and completed once they are applied. A circle without such an operation is refused with a `409`. `version` on an operation works like `If-Match`, and `failOnErrors` stops the request after as many failed operations.

A bulk request holds at most 1000 operations and weighs at most 1 MB, and more is refused with a `413`. Pass `bulk` to say otherwise:

```ts
@Controller('/partner/scim/v2')
export class PartnerScimController extends ScimController(CompanyScimProvisioner, {
    roles: [Role.PROVISIONING],
    bulk: { maxOperations: 100, maxPayloadSize: '256kb' }
}) {}
```

## Errors
A refused request answers the way SCIM says errors look:

```json
{
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
    "status": "409",
    "scimType": "uniqueness",
    "detail": "The userName anna@example.com is taken."
}
```

A request without a valid api key, or by a user without one of the `roles` in the tenant, is refused like any other route, with a `401` or a `403`.

## What gets recorded
| `action` | `outcome` | Carries |
|---|---|---|
| `scim.user.created` | success / failure | `userId` on success |
| `scim.user.updated` | success / failure | `userId` on success |
| `scim.user.deleted` | success / failure | `userId` on success |
| `scim.group.created` | success / failure | — |
| `scim.group.updated` | success / failure | — |
| `scim.group.deleted` | success / failure | — |

Deactivating and reactivating a user is recorded as `auth.user.deactivated` and `auth.user.reactivated`, see [what gets recorded](./auth.md#what-gets-recorded).

## See also
- [Tenants](./tenancy.md) — memberships, their roles, and deactivating one
- [Authentication & authorization](./auth.md) — deactivating a user, and the user repository
- [Api keys](./api-keys.md) — the key the identity provider calls with
- [Sign-in through a provider](./sign-in-through-a-provider.md) — signing the provisioned users in