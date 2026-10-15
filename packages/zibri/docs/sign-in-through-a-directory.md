# Sign-in through a directory
Users sign in with the name and password of their account in your company's directory, such as Active Directory, OpenLDAP or 389 Directory Server. The directory checks the password, so your application stores none. The sign-in ends in the same jwt or cookie login a password gives.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `BaseLdapAuthenticator` | class | Extend it once for every directory |
| `BaseActiveDirectoryAuthenticator` | class | The same, set up for Active Directory and Samba domains |
| `LdapCredentials` | class | What a user signs in with: `username` and `password` |
| `LdapEntry` | type | The entry of the directory a user signed in as |
| `LdapServiceAccount` | type | The account your application searches the directory with |
| `LdapIdentity` | entity | An entry of the directory, linked to the user it signs in as |
| `Ldapts` | type | The module of `ldapts`, which speaks LDAP |

## Setting it up
Install `ldapts`, and declare `LdapIdentity` in the data source your users live in.

Then extend `BaseLdapAuthenticator` for your directory:

```ts
// src/auth/company-directory.authenticator.ts
import { BaseLdapAuthenticator, inject, LdapEntry, LdapServiceAccount, repositoryTokenFor, Repository, Transaction } from 'zibri';

import { environment } from '../environment';
import { Role } from '../models/role.enum';
import { User } from '../models/user.model';

export class CompanyDirectoryAuthenticator extends BaseLdapAuthenticator<Role, User> {
    readonly name: string = 'company-directory';
    readonly urls: string[] = ['ldaps://ldap.example.com'];
    readonly serviceAccount: LdapServiceAccount = { dn: 'cn=app,ou=services,dc=example,dc=com', password: environment.ldapPassword };
    readonly searchBase: string = 'ou=people,dc=example,dc=com';
    readonly entryFilter: string = '(objectClass=inetOrgPerson)';
    readonly usernameAttributes: string[] = ['uid', 'mail'];
    readonly groupSearchBase: string | undefined = undefined;

    async resolveFirstSignIn(entry: LdapEntry, transaction: Transaction | undefined): Promise<User> {
        const [email] = entry.attributes['mail'] ?? [];
        return await inject<Repository<User>>(repositoryTokenFor(User)).create({ email, roles: [Role.USER] }, { transaction });
    }

    async resolveSignIn(entry: LdapEntry, user: User, transaction: Transaction | undefined): Promise<User> {
        return await Promise.resolve(user);
    }
}
```

And register it next to your strategy, and give it to the [auth routes](./auth-routes.md):

```ts
// src/application-options.ts
import { AuthController, Controller, JwtAuthStrategy, OtpTwoFactorMethod, ZibriApplicationOptions } from 'zibri';

@Controller('/auth', { versions: 'all' })
export class AppAuthController extends AuthController({
    strategies: [JwtAuthStrategy],
    authenticators: [CompanyDirectoryAuthenticator],
    twoFactorMethods: [OtpTwoFactorMethod]
}) {}

export const authOptions: Pick<ZibriApplicationOptions, 'authenticators' | 'authStrategies' | 'controllers'> = {
    authenticators: [CompanyDirectoryAuthenticator],
    authStrategies: [JwtAuthStrategy],
    controllers: [AppAuthController]
};
```

| Member | What it is |
|---|---|
| `name` | The name the links of the directory's entries to users are kept under. Every directory has a name of its own. Required |
| `urls` | The servers of the directory: `ldaps://host:636`, or `ldap://host:389`, which is upgraded with StartTLS. A sign-in starts at a random one, and moves on to the next when one cannot be reached. Required |
| `serviceAccount` | The account the entry of a user is searched for with. It needs to read the entries below `searchBase`, and the groups below `groupSearchBase`. Required |
| `searchBase` | Where in the directory users are searched for. Required |
| `entryFilter` | What every entry a user signs in as matches. Required |
| `usernameAttributes` | The attributes the typed name is looked for in. Exactly one entry has to match. Required |
| `groupSearchBase` | Where in the directory the groups of a user are searched for, see [groups](#groups). `undefined` to read no groups. Required |
| `resolveFirstSignIn` | Answers the user an entry signs in as, the first time anybody signs in as it, see [a first sign-in](#a-first-sign-in). Required |
| `resolveSignIn` | Answers the user of every later sign-in, from the user the entry is linked to, see [later sign-ins](#later-sign-ins). Required |
| `groupFilter` | What every group matches. `(objectClass=groupOfNames)` by default |
| `memberAttribute` | The attribute of a group that lists its members. `member` by default |
| `idAttribute` | The attribute holding the id the directory gave an entry, which never changes. `entryUUID` by default; `nsUniqueId` on 389 Directory Server |
| `attributes` | The attributes read from the entry for the hooks. All of them by default |
| `trustedCertificates` | The certificates, PEM encoded, of the authorities the directory's certificate is trusted from. The system's by default |
| `timeoutInMs` | How long the directory may take to answer. 10 seconds by default |

## Signing in
The user logs in at the login route, with the name and password they typed:

```txt
POST /auth/login?authenticator=company-directory
{ "username": "ada", "password": "..." }
```

Name the authenticator in `authenticator` when your auth controller has more than one, see [naming the strategy and the authenticator](./auth-routes.md#naming-the-strategy-and-the-authenticator). In a route of your own, `login` of `AuthServiceInterface` does the same.

The service account finds the one entry below `searchBase` that matches `entryFilter` and has the typed name in one of `usernameAttributes`. A bind as that entry checks the password.

| Answer | When |
|---|---|
| `401` | The password is wrong, no single entry has the name, or the directory refuses the account because it is disabled, locked or expired. Every one of them answers the same |
| An error of `resolveFirstSignIn` or `resolveSignIn` | The hook refused the sign-in, such as with a `ForbiddenError` |
| `500` | No server of the directory can be reached or has a trusted certificate, or the service account cannot bind |

The audit trail records the typed name as the `subject` of the login.

## A first sign-in
An entry is linked to a user by the id the directory gave it, so a sign-in finds its user after the entry is moved or renamed. The first time anybody signs in as an entry, `resolveFirstSignIn` gets the entry and answers the user it signs in as. Create one, find one, or throw an http error to refuse:

```ts
// src/auth/app-users-directory.authenticator.ts
import { $ts, ForbiddenError, inject, LdapEntry, repositoryTokenFor, Repository, Transaction } from 'zibri';

export class AppUsersDirectoryAuthenticator extends CompanyDirectoryAuthenticator {
    override readonly groupSearchBase: string = 'ou=groups,dc=example,dc=com';

    override async resolveFirstSignIn(entry: LdapEntry, transaction: Transaction | undefined): Promise<User> {
        if (!entry.groups.includes('cn=app-users,ou=groups,dc=example,dc=com')) {
            throw new ForbiddenError($ts`Your account has no access to this application.`);
        }
        const [email] = entry.attributes['mail'] ?? [];
        return await inject<Repository<User>>(repositoryTokenFor(User)).create({ email, roles: [Role.USER] }, { transaction });
    }
}
```

`entry.attributes` holds the attributes that were read, by their name in lowercase. A value that is not text is base64 encoded.

Two first sign-ins as the same entry at once make one user: the second waits for the first.

## Later sign-ins
Every later sign-in as an entry finds the user it is linked to, and is refused once that user is deleted. `resolveSignIn` gets the entry and that user, and answers the user the sign-in logs in as: updated from the entry, or as it is. Throw an http error to refuse.

Keep the roles of a user in step with their groups, so that someone taken out of a group in the directory loses its role at their next sign-in:

```ts
// src/auth/role-directory.authenticator.ts
import { inject, LdapEntry, repositoryTokenFor, Repository, Transaction } from 'zibri';

const ADMINS: string = 'cn=admins,ou=groups,dc=example,dc=com';

export class RoleDirectoryAuthenticator extends CompanyDirectoryAuthenticator {
    override readonly groupSearchBase: string = 'ou=groups,dc=example,dc=com';

    override async resolveSignIn(entry: LdapEntry, user: User, transaction: Transaction | undefined): Promise<User> {
        const roles: Role[] = entry.groups.some(dn => dn.toLowerCase() === ADMINS) ? [Role.ADMIN] : [Role.USER];
        return await inject<Repository<User>>(repositoryTokenFor(User)).updateById(user.id, { roles }, { transaction });
    }
}
```

A session that is already open keeps the roles it was started with.

## Groups
With a `groupSearchBase`, every sign-in reads the groups of the entry as the service account, once the password is checked. `entry.groups` holds the distinguished names of the groups below `groupSearchBase` that match `groupFilter` and list the entry in their `memberAttribute`, and of the groups those are members of, as deep as they go. A distinguished name is written the way the directory writes it, so compare names without regard to case.

## Active Directory
`BaseActiveDirectoryAuthenticator` is set up for Active Directory and Samba domains. Users sign in with their account name (`anna`), their user principal name (`anna@example.com`) or their down-level logon name (`EXAMPLE\anna`), and an account is linked by its `objectGUID`:

```ts
// src/auth/company-domain.authenticator.ts
import { BaseActiveDirectoryAuthenticator, inject, LdapEntry, LdapServiceAccount, repositoryTokenFor, Repository, Transaction } from 'zibri';

import { environment } from '../environment';
import { Role } from '../models/role.enum';
import { User } from '../models/user.model';

export class CompanyDomainAuthenticator extends BaseActiveDirectoryAuthenticator<Role, User> {
    readonly name: string = 'company-domain';
    readonly netbiosName: string = 'EXAMPLE';
    readonly urls: string[] = ['ldaps://dc1.example.com', 'ldaps://dc2.example.com'];
    readonly serviceAccount: LdapServiceAccount = { dn: 'CN=app,CN=Users,DC=example,DC=com', password: environment.domainPassword };
    readonly searchBase: string = 'CN=Users,DC=example,DC=com';
    readonly groupSearchBase: string = 'DC=example,DC=com';
    override readonly trustedCertificates: string[] = [environment.domainCaCertificate];

    async resolveFirstSignIn(entry: LdapEntry, transaction: Transaction | undefined): Promise<User> {
        const [email] = entry.attributes['userprincipalname'] ?? [];
        return await inject<Repository<User>>(repositoryTokenFor(User)).create({ email, roles: [Role.USER] }, { transaction });
    }

    async resolveSignIn(entry: LdapEntry, user: User): Promise<User> {
        return await Promise.resolve(user);
    }
}
```

| Member | What it is |
|---|---|
| `netbiosName` | The NetBIOS name of the domain, which a down-level logon name starts with. A name that starts with another domain's is refused like an unknown one. Required |

The groups of an account are found in one search, nested ones included. The primary group of an account, usually `Domain Users`, is not among them.

## See also
- [Authentication & authorization](./auth.md) — strategies, authenticators and `AuthService`
- [Sign-in through a provider](./sign-in-through-a-provider.md) — OpenID Connect, OAuth2 and SAML
- [Testing](./testing.md#a-fake-directory) — a directory inside your tests