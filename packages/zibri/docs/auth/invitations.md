---
keywords: [invite, invitation link, onboarding, add a member, join a team]
---

# Inviting people
An invitation asks somebody by email to join your application, or a [tenant](../glossary.md#tenant) with roles there. They follow the link it mails them and accept, which creates their account with a password, or adds the account they have to the tenant. Inviting is opt-in: an application without an invitation repository has no invitations.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `BaseInvitationEntity`, `BaseInvitation` | function, type | What your invitation entity extends: the `email`, the `tenantId`, the `roles`, when the account is created and the hash of the link's token |
| `BaseInvitationRepository`, `InvitationRepositoryInterface` | function, interface | The base class the repository of your invitation entity extends, with the `createInvitedUser` you implement |
| `InvitationOptions` | type | How invitations are sent, via `ZIBRI_DI_TOKENS.INVITATION_OPTIONS`. Required with an invitation repository |
| `ZIBRI_DI_TOKENS.INVITATION_SERVICE`, `InvitationServiceInterface` | DI token, interface | Invites, sends again, revokes, accepts and declines. Replaceable |
| `InvitationService` | class | Keeps the invitations in the one invitation repository. Replaceable through `ZIBRI_DI_TOKENS.INVITATION_SERVICE` |
| `InvitationCreateData`, `InvitationCreateOn` | type | What `invite` takes, and when the account and the [membership](../glossary.md#membership) are created: `'invite'` or `'accept'` |
| `InvitationEmailTemplate`, `InvitationEmailTemplateProps` | type | The email an invitation is sent in, and what it is given |
| `InvitationTokenValidity`, `InvitationTokenInput`, `AcceptInvitationInput` | class | What the routes answer and take |
| `InvitationAcceptance` | type | Who accepts an invitation, and with what, as `accept` takes it |
| `AuthControllerInvitationRoutes` | type | The methods of the routes of `invitationRoutes` |
| `INVITATION_ENTITY`, `INVITATION_REPOSITORY`, `isInvitationRepository`, `InvitationRepositoryClass` | constant, function, type | Mark an entity and a repository as the ones of invitations, and tell such a repository apart. The base classes set the marks |

## Setting it up
Extend `BaseInvitationEntity`, with the columns of your own the account of an invitation is created from, and declare it with `expiresBy: 'expiresAt'`:

```ts
// src/models/invitation.model.ts
import { BaseInvitationEntity, Entity, Property } from 'zibri';

@Entity({ uniques: [['email']], expiresBy: 'expiresAt' })
export class Invitation extends BaseInvitationEntity() {
    @Property.string()
    name!: string;
}
```

Its tenant is optional: an invitation to a tenant belongs to it, one to the application only to none. The unique is per tenant, so an email has one open invitation in each.

Its repository extends `BaseInvitationRepository` and creates the user an invitation is for, whose email has no account yet:

```ts
// src/repositories/invitation.repository.ts
import { BaseInvitationRepository, BaseUser, inject, Repository, RepositoryFor, repositoryTokenFor, RepositoryTransaction } from 'zibri';

import { Invitation } from '../models/invitation.model';
import { Roles } from '../models/roles.enum';
import { User } from '../models/user.model';

@RepositoryFor(Invitation)
export class InvitationRepository extends BaseInvitationRepository<Invitation>() {
    override async createInvitedUser(invitation: Invitation, transaction: RepositoryTransaction | undefined): Promise<BaseUser<string>> {
        return await inject<Repository<User>>(repositoryTokenFor(User)).create({ email: invitation.email, roles: [Roles.USER] }, { transaction });
    }
}
```

Declare `Invitation` in the data source your users live in, list the repository, and provide the options:

```ts
// src/providers.ts
import { defineProvider, InvitationOptions, ZIBRI_DI_TOKENS } from 'zibri';

import { InvitationEmail } from './templates/emails/invitation';

defineProvider({
    token: ZIBRI_DI_TOKENS.INVITATION_OPTIONS,
    useValue: {
        // the page of your frontend a link opens
        acceptInvitationUrl: 'https://app.example.com/invitation',
        invitationEmail: InvitationEmail,
        tokenExpiresInMs: 7 * 24 * 60 * 60 * 1000,
        onExpiredToken: 'renew'
    } satisfies InvitationOptions
})
```

| Option | What it is |
|---|---|
| `acceptInvitationUrl` | Where a link points. The link is this url, a `/` and the token, with the tenant of an invitation to one put in by `resolveTenantUrl` of the [`TenantService`](../data/tenancy.md#the-tenant-of-a-request). Required |
| `invitationEmail` | The email an invitation is sent in. It is given the `link`, the `invitation`, with your own columns, and the `tenant` it is to, read from the [entity of the tenants](../data/tenancy.md#declaring-the-tenants) when you declare one. Required |
| `tokenExpiresInMs` | How long a link works. The invitation itself lasts until it is answered or revoked. Required |
| `onExpiredToken` | What following a link that stopped working does: `'renew'` mails a new link to the invited email, `'refuse'` refuses it. Required |

Give `AuthController` `invitationRoutes: true` for the routes that answer a link:

```ts
// src/controllers/auth.controller.ts
import { AuthController, Controller, JwtAuthStrategy, OtpTwoFactorMethod, PasswordAuthenticator } from 'zibri';

@Controller('/auth', { versions: 'all' })
export class AppAuthController extends AuthController({
    strategies: [JwtAuthStrategy],
    authenticators: [PasswordAuthenticator],
    twoFactorMethods: [OtpTwoFactorMethod],
    invitationRoutes: true
}) {}
```

## Inviting somebody
Invite from a route of your own, which says who may invite. `invite` takes the caller, and checks the roles like [`assignRole`](./roles-and-permissions.md#managing-roles) checks them, so nobody invites into more than they may hand out:

```ts
// src/controllers/invitation.controller.ts
import { Auth, Body, Controller, CurrentUser, inject, Post, Property, ZIBRI_DI_TOKENS } from 'zibri';

import { Invitation } from '../models/invitation.model';
import { MemberRoles } from '../models/member-roles.enum';
import { User } from '../models/user.model';

export class InvitationRequest {
    @Property.string({ format: 'email' })
    email!: string;

    @Property.string()
    name!: string;
}

@Controller('/invitations')
export class InvitationController {
    @Auth.isLoggedIn()
    @Post('/')
    async invite(@CurrentUser() user: CurrentUser<User>, @Body(InvitationRequest) request: InvitationRequest): Promise<Invitation> {
        return await inject(ZIBRI_DI_TOKENS.INVITATION_SERVICE).invite<Invitation>(user, {
            ...request,
            tenantId: inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).getActiveTenantId(),
            roles: [MemberRoles.USER],
            createOn: 'accept',
            declinable: true,
            expiresInMs: undefined
        }, undefined);
    }
}
```

| Field | What it is |
|---|---|
| `email` | Who is invited. Required |
| `tenantId` | The tenant they join, or `undefined` for the application only. Required |
| `roles` | Tenant roles of the tenant, or platform roles without one. Required |
| `createOn` | `'accept'` creates the account and the membership once the invitation is accepted, so nobody gets one they never agreed to. `'invite'` creates them at once, so an administrator manages them before the invited person reacts. Required |
| `declinable` | Whether the invited person may decline it. Required |
| `expiresInMs` | How long the invitation lasts, or `undefined` for one that lasts until it is answered or revoked. Required |
| `locale` | The locale the invitation is mailed in, its link sent again included, and the account it creates gets. The `locale` of the account the email has by default, else the locale of the request inviting |
| `withoutPassword` | Whether the account the invitation creates gets no password, see [accepting without a password](#accepting-without-a-password). `false` by default |
| `rowShares` | Rows of the tenant shared with the invited person once they accept, each in a role its entity declares, see [sharing a row by email](../data/sharing.md#sharing-a-row-by-email). None by default |

Tenant roles are handed out in the tenant the request acts in with `auth.assign_role` of the caller's membership, and in any tenant with `auth.assign_role_in_any_tenant.with_any_permission` of their own, such as by the support of your application. Platform roles need `auth.assign_platform_role`. A caller who may not is answered `403`, and nothing is stored. An email with an open invitation there, or a member of the tenant, is answered `409`.

With `createOn: 'invite'`, an email without an account gets one from `createInvitedUser`, with the platform roles of an invitation to the application, and the membership with the roles of an invitation to a tenant. An account the email has keeps its platform roles until it accepts.

## Accepting and declining
The page at `acceptInvitationUrl` takes the token from its path:

| Route | Takes | Who calls it |
|---|---|---|
| `POST /auth/verify-invitation-token` | `{ "token" }`. Answers `{ "isValid", "renewed", "email", "tenantId", "requiresLogin", "declinable", "withoutPassword" }` | anyone, with the link |
| `POST /auth/accept-invitation` | `{ "token", "password", "locale" }`, the `locale` optional, and no `password` when `withoutPassword`. Answers `204`, or a login when `withoutPassword` | anyone with the link, logged in as the account of the email when `requiresLogin` |
| `POST /auth/decline-invitation` | `{ "token" }` | anyone, with the link |

`requiresLogin` is true for an email whose account existed before the invitation. That account accepts logged in, without a password, so a forwarded link adds no other account to the tenant: logged out it is answered `401`, as somebody else `403`. Otherwise accepting takes the password of the account it creates, or of the one `createOn: 'invite'` created, which `PasswordAuthenticator` stores. Accepting creates the membership with the roles, or gives the platform roles, marks the email as verified, since the link reached it, and deletes the invitation. A membership `createOn: 'invite'` created keeps the roles an administrator gave it since.

The account an invitation creates gets the [locale](../templates/localization.md#the-locale-of-a-user) of the invitation. A `locale` sent with the acceptance, such as the language the user picked on the page, replaces it, and one your application does not support is answered `400`.

A link that was used, revoked or sent again is answered `401`. Declining one that may not be declined is answered `403`, and so are inviting into and accepting an invitation to a [deactivated tenant](../data/tenancy.md#deactivating-a-tenant), whose link works again once it is reactivated.

## Accepting without a password
An invitation with `withoutPassword: true` creates its account without a password, for people who use your application rarely, such as customers looking at a shared project. Accepting it takes no `password`, and logs the new user in by the link the invitation came with, as a [login with a link](./login-links.md) does: it answers what `POST /auth/login` answers, with `?strategy=` naming the strategy when there are several, or the `401` of a login that waits for a [second factor](./two-factor.md#asking-for-a-second-factor-at-login). Later, the user logs in with a link sent by email. A `password` sent with it is answered `400`.

While such a user has no second factor, their login by a link counts as a [recent login](./two-factor.md#accepting-a-recent-login-instead), since a link is all they confirm who they are with: a route with `@Auth.require2fa({ reauth: true })` lets them through for a while after it, and then asks them for a new link, see [the second factor](./login-links.md#the-second-factor).

`POST /auth/verify-invitation-token` answers `withoutPassword: true` for such an invitation, so the page asks for no password. It answers `false` where accepting needs a login: an email with an account of its own accepts logged in, as for any invitation.

Inviting without a password needs `LoginLinkAuthenticator` among the [authenticators](../glossary.md#authenticator), and is answered `400` otherwise. An `InvitationServiceInterface` of your own logs the account in by implementing `acceptForLogin`, which answers the id of the account to log in.

## Sending it again and revoking
`resend` of the `InvitationService` mails a new link, and the previous one stops working. `revoke` withdraws the invitation. Both read it by id the way its repository reads it in the active tenant, so a tenant's administrators reach the invitations of their tenant only. `findInvitations` answers the open invitations of the active tenant, or those to the application only while no tenant is active.

Revoking and declining undo what `createOn: 'invite'` created: the membership, and the account while nobody verified its email, it belongs to no tenant and no other invitation is open for its email. An invitation that is answered or revoked is deleted.

## When a link expires
A link works for `tokenExpiresInMs`. Following one later is refused, and with `onExpiredToken: 'renew'` a new link is mailed to the invited email, once for each link: `POST /auth/verify-invitation-token` answers `renewed: true`. An invitation with `expiresInMs` ends then, is refused, and is deleted within the hour. What `createOn: 'invite'` created stays.

## What gets recorded
Each is recorded in the tenant of the invitation, with the invited email as `subject`:

| `action` | `outcome` | Carries |
|---|---|---|
| `auth.invitation.created` | success / failure | the inviter as `userId` |
| `auth.invitation.resent` | success / failure | |
| `auth.invitation.accepted` | success / failure | the logged in user as `userId`, when accepted logged in |
| `auth.invitation.declined` | success / failure | |
| `auth.invitation.revoked` | success / failure | |
| `auth.invitation.expired` | success | |

## See also
- [Tenants](../data/tenancy.md) — memberships, and the tenant a request acts in
- [Roles and permissions](./roles-and-permissions.md) — which roles a caller may hand out
- [The auth routes](./auth-routes.md) — every route `AuthController` defines
- [Logging in with a link](./login-links.md) — how an account without a password logs in
- [Sharing rows with selected people](../data/sharing.md) — inviting a guest who sees only the rows shared with them
- [Email](../templates/email.md) — the template an invitation is sent in
