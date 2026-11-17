---
keywords: [terms, definitions, vocabulary, meaning]
---

# Glossary
The words the pages share, each with what it means in Zibri and the page that covers it. A page links
a word here the first time it uses it.

## API key
A secret a script, a service or an integration sends with every request, which acts as one of your
users. Each key has a name, the permissions it may use and an expiry. See [API keys](./auth/api-keys.md).

## Auth strategy
What carries a login from one request to the next, such as a bearer token or a session cookie, and
says who a request is from. `JwtAuthStrategy` is the default. See
[registering strategies and authenticators](./auth/auth.md#registering-strategies-and-authenticators).

## Authenticator
What checks who someone is when they log in, such as by email and password, with a passkey or through
a provider. Its login is then carried by an auth strategy. See
[registering strategies and authenticators](./auth/auth.md#registering-strategies-and-authenticators).
An authenticator app, which shows the codes of a [second factor](#second-factor), is something else.

## Change set
The record of one change to a row: who changed it, when, and what. A `ChangeSetRepository` writes one
with every change. See [recording who changed what](./data/data-source.md#recording-who-changed-what).

## Claim
Two meanings:
- a field of a token, such as the `sub` or `email` of an ID token a provider issues.
- the right of one instance to do a piece of work, such as an event, a mail or a cron slot, so that no
  other instance does it too. A claim is a [lease](#lease).

## Credential
Two meanings:
- what a request proves who it is from with: a token, a session cookie, an API key or a client
  certificate. A request carries exactly one. The password a user logs in with is stored as their
  `PasswordCredentials`. See [one credential per request](./auth/auth.md#one-credential-per-request).
- what your application signs in to another service with, such as the user and password of a mail
  server or a database.

## Data key
A key that encrypts your values. Data keys are generated for you, and stored encrypted with the
[master key](#master-key). See [setting the master key](./data/encryption-and-hashing.md#setting-the-master-key).

## DPoP
Demonstrating proof of possession: a client binds its tokens to a key pair, and signs a proof with the
private key for every request. A bound token that leaks without the key is worth nothing. See
[DPoP](./auth/dpop.md).

## Envelope encryption
How encrypted properties are stored: each value is encrypted with a [data key](#data-key), and the
data keys are encrypted with the [master key](#master-key). Rotating the master key re-encrypts the
data keys, not your values. See [encryption and hashing](./data/encryption-and-hashing.md).

## Grant
Two meanings:
- the stored right to a [lease](#lease), which a holder renews and releases. See
  [bringing your own grant](./data/leases.md#bringing-your-own-grant).
- the way an OAuth2 client obtains a token, such as the client credentials grant of the
  [authorization server](./auth/authorization-server.md).

## Hash chain
Rows that each carry a keyed hash of their own content and of the row before them. A row changed,
removed or slipped in breaks the chain from there on, and only the holder of the key can write a hash
that fits. See [tamper-evident tables](./data/tamper-evident-tables.md).

## Identity
An account of a user somewhere else, such as at Google or in your company's directory, linked to the
user it logs in as. A passkey is an identity too. See
[connecting a provider to an account](./auth/login-through-a-provider.md#connecting-a-provider-to-an-account).
An identity provider is the service holding such accounts, see [provider](#provider).

## Lease
The right to do a piece of work that no other instance may do at the same time, for a limited time.
Cron elections, event and mail claims and named locks are leases. See [leases](./data/leases.md).

## Login
Two meanings:
- the act of a user proving who they are, with an [authenticator](#authenticator).
- what that act starts: the state an [auth strategy](#auth-strategy) carries from one request to the
  next until the user logs out or it expires. See [how long a login lasts](./auth/auth.md#how-long-a-login-lasts).

## Master key
The key you provide, which encrypts the [data keys](#data-key). It is the one key that has to stay
secret outside the database. See [setting the master key](./data/encryption-and-hashing.md#setting-the-master-key).

## Membership
A user's place in one tenant, holding the names of their roles there. A user belongs to the tenants
they have a membership in. See [members and their roles](./data/tenancy.md#members-and-their-roles).

## OpenID Connect
A standard way for an identity provider, such as Google, Microsoft Entra ID or Keycloak, to log a user
in to your application and tell it who they are. See
[login through a provider](./auth/login-through-a-provider.md).

## Passkey
A key a phone, laptop or security key holds, which it only uses once its owner has touched a
fingerprint reader, shown their face or typed the device's PIN. Users log in with it, and it is a
second factor too. See [passkeys](./auth/passkeys.md).

## Provider
Three meanings:
- what the DI container builds a value from, declared with `defineProvider`. See [DI](./application/di.md).
- an identity provider: a service your users have an account at, which logs them in, such as Google
  or Keycloak. See [login through a provider](./auth/login-through-a-provider.md).
- a service a plugin hands work to, such as a payment provider. See [payments](./plugins/payment-plugin.md).

## Recent login
A login that is younger than a route asks for. A route guarded by `@Auth.require2fa({ reauth })`
accepts it in place of a second factor. See
[accepting a recent login instead](./auth/two-factor.md#accepting-a-recent-login-instead).

## SAML
Security Assertion Markup Language, an older standard for the same as OpenID Connect: an identity
provider logs a user in and tells your application who they are. See
[SAML](./auth/login-through-a-provider.md#saml).

## Scope
Three meanings:
- a function on an entity that narrows every query on it by the request, such as to the invoices of
  the user's own team. It narrows within the tenant. `unscoped` lifts it for one call, and
  `restrictedTo` is the scope you declare. See
  [restricting which rows a caller may see](./data/data-source.md#restricting-which-rows-a-caller-may-see).
- what an OAuth2 token may be used for, such as the APIs of a provider or the permissions of a token
  the [authorization server](./auth/authorization-server.md) issues.
- how long the DI container keeps what it builds. See [DI](./application/di.md).

## SCIM
System for Cross-domain Identity Management: routes your application offers, which a tenant's identity
provider calls to create, update and remove its people. See [SCIM](./auth/scim.md).

## Second factor
A further proof a user presents beside their login, such as a code from their phone or a passkey.
Routes require one with `@Auth.require2fa`. See
[what a second factor is for](./auth/two-factor.md#what-a-second-factor-is-for).

## Session
Two meanings:
- the stored login of `CookieAuthStrategy`, which its session cookie names. See
  [how long a login lasts](./auth/auth.md#how-long-a-login-lasts).
- the session at an identity provider a login was started from, which ends the login when the user
  logs out there. See [logging out](./auth/login-through-a-provider.md#logging-out).

## Slot
A time a cron job is due, such as 03:00 for a job that runs every night. Each slot runs once, on one
instance. See [cron](./background-work/cron.md).

## Soft delete
A delete that marks a row as deleted and keeps it. Reads and writes leave such rows out unless the
call's `deleted` option says otherwise. See [soft deleting rows](./data/data-source.md#soft-deleting-rows).

## Tenant
One customer of your application, such as a team, with its own rows. Every row belongs to one tenant
or is shared by all of them, and every call is narrowed to the tenant the work is done for.
`acrossTenants` lifts that for one call. See [tenancy](./data/tenancy.md). Microsoft Entra ID calls the
directory of an organization a tenant, which is a different thing.

## Ticket
A one-time value a login goes on with: after a first login through a provider, so your registration
can create the user, and while a login waits for its second factor. See
[a first login](./auth/login-through-a-provider.md#a-first-login).

## See also
- [Auth](./auth/auth.md) — logging users in and guarding routes
- [Tenancy](./data/tenancy.md) — tenants, memberships and what is narrowed
- [Data source](./data/data-source.md) — scopes, change sets and soft deletes
- [Leases](./data/leases.md) — work only one instance may do
