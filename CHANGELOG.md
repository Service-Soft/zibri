# Changelog

What changed in each release of `zibri`, `zibri-tsx`, `zibri-testing` and `zibri-cli`. The four are released together, at one version.

## 3.0.0

A major release. An application on 2.x needs changes before it starts on 3.0.0, and its database needs a migration. [Upgrading to 3](https://service-soft.github.io/zibri/documents/upgrading-to-3.html) lists both: what the compiler does not tell you about, and the migration for the tables Zibri ships. Back up your database first.

Zibri 3 needs node 24 or newer.

### New packages
- **`zibri-tsx`** compiles the `.tsx` templates of pages and emails at build time, in place of preact. A component can carry code that runs in the browser. See [templating](https://service-soft.github.io/zibri/documents/templating.html).
- **`zibri-testing`** starts your application in a test with the router, auth, lifecycle and error handling production has. Its in-memory data source needs no database, and it starts Postgres and Valkey containers or a cluster of instances when a test asks for them. See [testing](https://service-soft.github.io/zibri/documents/testing.html).
- **`zibri/internal`** is a second entry point of `zibri`, for what only a data source, driver, parser or router of your own needs. See [releases](https://service-soft.github.io/zibri/documents/releases.html#what-is-public).

### Generating and upgrading a project
- `zi new` writes a project that builds, tests and runs as it stands, with a Dockerfile, a CI workflow and its configuration read from the environment. Pages, mailing lists, a metrics dashboard and a log email are features you choose.
- `zi add` and `zi remove` add or remove a feature later.
- `zi upgrade` merges what a new release generates into your project, the way git merges a branch.
- `zi migrate` creates a migration from what your entities changed, and records a baseline.
- The build, the jest configuration and the compiler options come from the packages: `zibri/webpack`, the `zibri-testing` preset and `zibri/tsconfig.application.json`. Updating the packages updates them.
- A deployed image names the source file and line in every stack trace.

See [getting started](https://service-soft.github.io/zibri/documents/getting-started.html) and [the generated project](https://service-soft.github.io/zibri/documents/project-layout.html).

### Data
- **Postgres without TypeORM.** The Postgres data source talks to `pg` itself and builds its queries itself. How the schema is managed, TLS and the pooler in front of the database are options you set. See [data sources](https://service-soft.github.io/zibri/documents/data-source.html).
- **Valkey data source**, with the same repositories as Postgres.
- **Tenants.** Every row belongs to a tenant or is shared, and every read and write stays inside the tenant of the request. See [tenants](https://service-soft.github.io/zibri/documents/tenancy.html).
- **Transactions across data sources**, and a `TransactionConflictError` for a deadlock or a serialization failure.
- **Tamper-evident tables.** Append-only entities, and chained entities whose rows form a hash chain. See [tamper-evident tables](https://service-soft.github.io/zibri/documents/tamper-evident-tables.html).
- **What a call costs.** Every repository call has a documented number of round trips. See [costs](https://service-soft.github.io/zibri/documents/costs.html).

### Logging in
- **Single sign-on** through OpenID Connect (Google, Apple, Microsoft Entra ID, Keycloak), plain OAuth2 (GitHub) and SAML 2.0. See [login through a provider](https://service-soft.github.io/zibri/documents/login-through-a-provider.html).
- **Directory login** against LDAP, such as Active Directory. See [login through a directory](https://service-soft.github.io/zibri/documents/login-through-a-directory.html).
- **Passkeys**, to log in and as a second factor, and recovery codes beside TOTP. See [passkeys](https://service-soft.github.io/zibri/documents/passkeys.html) and [two factor](https://service-soft.github.io/zibri/documents/two-factor.html).
- **Services calling your API** with [API keys](https://service-soft.github.io/zibri/documents/api-keys.html), [client certificates](https://service-soft.github.io/zibri/documents/client-certificates.html), [tokens your application issues](https://service-soft.github.io/zibri/documents/authorization-server.html) or [tokens of your identity provider](https://service-soft.github.io/zibri/documents/provider-tokens.html). Tokens can be bound to a key with [DPoP](https://service-soft.github.io/zibri/documents/dpop.html).
- **Roles and permissions.** Roles are rows, permissions are declared in code, at the tenant or the platform level, with wildcards. See [roles and permissions](https://service-soft.github.io/zibri/documents/roles-and-permissions.html).
- **SCIM provisioning** from a tenant's identity provider. See [SCIM](https://service-soft.github.io/zibri/documents/scim.html).
- **Email verification**, a required password policy, scrypt as the default hash, and an optional lock after too many wrong passwords. See [verifying email addresses](https://service-soft.github.io/zibri/documents/email-verification.html) and [auth](https://service-soft.github.io/zibri/documents/auth.html).
- **`AuthController`** defines the auth routes. See [the auth routes](https://service-soft.github.io/zibri/documents/auth-routes.html).
- **Audit trail.** Logins, refused routes, password resets and role changes are recorded in a tamper-evident trail. See [audit trail](https://service-soft.github.io/zibri/documents/audit.html).

### Running in production
- **Several instances.** Cron jobs, events, mails and named locks are claimed through [leases](https://service-soft.github.io/zibri/documents/leases.html), so every instance is equal. See [replication](https://service-soft.github.io/zibri/documents/replication.html).
- **Tracing** through OpenTelemetry, and metrics labeled by route. See [tracing](https://service-soft.github.io/zibri/documents/tracing.html) and [metrics](https://service-soft.github.io/zibri/documents/metrics.html).
- **Backups** to S3 and SFTP beside a folder, encrypted, and key rotation for encrypted properties. See [backup](https://service-soft.github.io/zibri/documents/backup.html) and [encryption and hashing](https://service-soft.github.io/zibri/documents/encryption-and-hashing.html#rotating-a-key).
- **Limits on requests and statements**, and an HTTP client that stops calling an upstream that keeps failing.
- **XML** request and response bodies, validated against a model like JSON. See [XML](https://service-soft.github.io/zibri/documents/xml.html).
- **Recovering failed work.** A failed cron job, event, thread job, mail or backup keeps what it failed with, and can be started again. See [recovering work that stopped](https://service-soft.github.io/zibri/documents/troubleshooting.html).

### Packages you install
Zibri installs only what every application needs. The package of each feature, such as `pg`, `nodemailer` or `socket.io`, is installed by the application that uses it, and the application names a missing one while it starts. See [optional packages](https://service-soft.github.io/zibri/documents/getting-started.html#optional-packages).

### Documentation
The documentation is rewritten: one page per topic, each with its exports, the packages and tables it needs, and examples that compile. New pages cover [architecture](https://service-soft.github.io/zibri/documents/architecture.html), [deployment](https://service-soft.github.io/zibri/documents/deployment.html), [configuration](https://service-soft.github.io/zibri/documents/configuration.html), [framework tables](https://service-soft.github.io/zibri/documents/framework-tables.html), a [glossary](https://service-soft.github.io/zibri/documents/glossary.html) and a [FAQ](https://service-soft.github.io/zibri/documents/faq.html).
