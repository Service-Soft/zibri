# Configuring the framework
Everything the framework reads that your application can change is a token of `ZIBRI_DI_TOKENS`:
every lifetime, limit, header name, template, secret and replaceable service. Every token is listed
below with its type, what it is and its default, and links to the page that explains it. The
built-in plugins have tokens of their own, listed on the page of each: [issuing invoices](./invoicing-plugin.md#configuring-the-plugin),
[running mailing lists](./mailing-list-plugin.md#configuring-the-plugin) and [taking payments](./payment-plugin.md#configuring-the-plugin).

## Providing a token
Provide a value under a token in your providers array, see [dependency injection](./di.md#configuration):

```ts
// src/providers.ts
import { defineProvider, DiProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

export const providers: DiProvider<unknown>[] = [
    defineProvider({ token: ZIBRI_DI_TOKENS.HTTP_DRAIN_TIMEOUT_IN_MS, useValue: Ms.SECOND * 20 })
];
```

A token whose name ends in `_INPUT` takes the options you set. They are merged over the defaults
into the token of the same name without `_INPUT`, which is the one to read.

## Setting what every application needs
These have no default, and every application provides them. `zi new` writes them into
`src/providers.ts`, see [the generated project](./project-layout.md).

| Token | Type | What it is |
|---|---|---|
| [`ENCRYPTION_MASTER_OPTIONS`](./encryption-and-hashing.md) | `EncryptionMasterOptions` | The key that encrypts the encryption keys. Required |
| [`EMAIL_CONFIG`](./email.md) | `EmailConfigInput` | The sender, the rate limit and how the queue is drained. Required |
| [`EMAIL_TRANSPORT`](./email.md) | `EmailTransportInterface` | What delivers a mail, such as `SmtpEmailTransport`. Required in production, a `LoggingEmailTransport` in development |
| [`AUDIT_RETENTION_IN_MS`](./audit.md) | `RetentionInMs` | How long an audit entry is kept, or `'forever'`. Required |
| [`EVENT_FAILED_RETENTION_IN_MS`](./events.md#when-an-event-cannot-be-handled) | `RetentionInMs` | How long a failed event is kept, or `'forever'`. Required |
| [`THREAD_JOB_RETENTION_IN_MS`](./multithreading.md#what-happens-to-a-finished-job) | `RetentionInMs` | How long a thread job that is over is kept, or `'forever'`. Required |

See [why every application sets up email, events and thread jobs](./faq.md#why-does-every-application-set-up-email-events-and-thread-jobs).

## Running without email, events or thread jobs
Replace the service under its token with one that sets nothing up. The application then provides
neither its tokens nor its entities. For email, implement `EmailServiceInterface`:

```ts
// src/services/mailless-email.service.ts
import { EmailServiceInterface, InternalError } from 'zibri';

export class MaillessEmailService implements EmailServiceInterface {
    queue(): Promise<void> {
        throw new InternalError('This application sends no mail.');
    }

    sendQueuedEmails(): Promise<boolean> {
        return Promise.resolve(false);
    }

    deleteExpiredFailedEmails(): Promise<number> {
        return Promise.resolve(0);
    }
}
```

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

import { MaillessEmailService } from './services/mailless-email.service';

defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_SERVICE, useClass: MaillessEmailService });
```

The application then needs neither `EMAIL_CONFIG`, `EMAIL_TRANSPORT` nor the `Email` entity. A
feature that sends mail, such as a password reset, fails with the error `queue` throws.

For events and thread jobs, extend `EventService` or `MultithreadingService` and leave `onAppInit`
empty. The application then needs neither the retention nor the entities, and emitting an event or
queuing a job fails.

## Setting what a feature needs
These have no default either. An application using the feature provides them.

| Token | Type | What it is |
|---|---|---|
| [`JWT_AUTH_OPTIONS_INPUT`](./auth.md#what-a-jwt-has-to-prove) | `JwtAuthOptionsInput` | The keys, secrets and lifetimes of `JwtAuthStrategy`. The access token key and the refresh token secret are required with it. An access token lasts an hour and a refresh token 30 days by default |
| [`COOKIE_SIGN_SECRET`](./auth.md#setting-the-session-cookie-flags) | `string` | The secret cookies are signed with. Required by `CookieAuthStrategy` |
| `CONFIRM_PASSWORD_RESET_URL` | `string` | The page of your frontend a password reset email links to. Required by `PasswordAuthenticator` |
| `PASSWORD_RESET_EMAIL_TEMPLATE` | `PasswordResetEmailTemplate` | The email carrying that link. Required by `PasswordAuthenticator` |
| [`EMAIL_VERIFICATION_OPTIONS`](./email-verification.md#setting-it-up) | `EmailVerificationOptions \| undefined` | How email addresses are verified. Not at all by default |
| [`EMAIL_VERIFICATION_SERVICE`](./email-verification.md) | `EmailVerificationServiceInterface` | Mails the links verifying and changing addresses, and confirms them |
| [`PASSKEY_OPTIONS`](./passkeys.md) | `PasskeyOptions` | The domain passkeys are bound to and the pages that use them. Required by `PasskeyAuthenticator` |
| [`FEDERATION_OPTIONS`](./login-through-a-provider.md) | `FederationOptions` | What every provider a user logs in at shares. Required by an [authenticator](./glossary.md#authenticator) of a provider |
| [`SMS_SERVICE`](./two-factor.md) | `SmsServiceInterface` | What sends a text message. Required by `SmsTwoFactorMethod` |
| [`SMS_CODE_LIMITS`](./two-factor.md) | `SmsCodeLimits` | What text messages may cost: how many an hour, how many to one number a day, and to which countries. Required by `SmsTwoFactorMethod` |
| [`WEBSOCKET_OPTIONS_INPUT`](./websocket.md) | `WebsocketOptionsInput` | The websocket options, `messageRetentionInMs` among them. Required by an application with websockets |

## Configuring logging and auditing

| Token | Type | What it is |
|---|---|---|
| [`LOGGER_TRANSPORTS`](./logging.md) | `LoggerTransport[]` | Where log entries are written. The console and the database, from `info` up, by default |
| [`LOGGER_BUFFER_CAPACITY`](./logging.md) | `number` | How many entries may wait to be written. 10000 by default |
| [`LOGGER_FLUSH_INTERVAL_IN_MS`](./logging.md) | `number` | How long entries gather before a write. One second by default |
| [`LOGGER_CLEANUP_AFTER_IN_MS`](./logging.md) | `Record<LogLevel, number>` | How long the entries of each level are kept in the database. Two weeks for every level by default |
| [`ACCESS_LOG`](./logging.md) | `boolean` | Whether one entry is written for every finished request. Off by default |
| [`AUDIT_MAX_REFUSALS_PER_MINUTE`](./audit.md) | `number` | How many refusals a minute are stored as entries of their own, on each instance. 1000 by default |
| [`AUDIT_INTEGRITY`](./audit.md#keeping-the-trail-as-a-chain) | `AuditIntegrity` | How the audit trail tells a changed entry: `'checkpoints'` or `'chain'`. `'checkpoints'` by default |

## Configuring the HTTP server

| Token | Type | What it is |
|---|---|---|
| [`HTTP_SERVER_LIMITS`](./creating-endpoints.md) | `HttpServerLimits` | How long a request, its headers, an idle connection and a handler may take, and how many and how large the headers may be. 60, 15, 5 and 30 seconds, 100 headers and 16 kilobytes by default |
| [`HTTP_DRAIN_TIMEOUT_IN_MS`](./application-lifecycle.md) | `number` | How long open requests may take to finish on shutdown. Ten seconds by default |
| [`COMPRESSION_OPTIONS`](./creating-endpoints.md) | `CompressionOptions` | Whether responses are compressed, and from what size on. On, from one kilobyte, by default |
| [`FORM_DATA_LIMITS`](./creating-endpoints.md) | `FormDataLimits` | How many files, parts and fields a multipart body may have. 20, 1000 and 500 by default |
| [`FILE_UPLOAD_TEMP_FOLDER`](./creating-endpoints.md) | `FsPath` | Where uploaded files are written. `.zibri/uploads` in the application's root by default |
| [`DEFAULT_CSP_OPTIONS_INPUT`](./app-settings.md) | `CspOptionsInput` | The content security policy of a page. Everything from your own origin only, by default |
| [`OPEN_API_AUTH`](./open-api.md#restricting-the-explorer) | `RouteAuthConfiguration` | Who may open the OpenAPI explorer and its documents. What `defaultAuth` says by default |
| `VERSION_HEADER` | `string` | Which header names the version a request asks for. `x-version` by default |
| `VERSION_QUERY_PARAM` | `string` | Which query parameter names the version a request asks for. `version` by default |
| [`VERSIONS_PATH`](./versioning.md) | `FsPath` | Where the routes of each released version are recorded. `versions` in the application's root by default |

## Configuring login

| Token | Type | What it is |
|---|---|---|
| [`REVALIDATE_USER_ON_AUTH_CHECK`](./auth.md) | `boolean` | Whether a check reads the account or trusts the credential. Reads the account by default |
| [`MAX_LOGINS_PER_USER`](./auth.md#where-a-user-is-logged-in) | `number \| undefined` | How many logins a user holds at most. No limit by default |
| [`PERMISSIONS`](./roles-and-permissions.md#declaring-permissions) | `PermissionDeclaration` | Every permission of your application. None by default, and a route or a role naming one is refused |
| [`ACCESS_TOKEN_REVOCATION`](./auth.md#what-a-credential-is-worth) | `AccessTokenRevocation` | When an access token stops working once its login has ended. `'onExpiry'` by default |
| [`AUTH_RATE_LIMIT_OPTIONS`](./auth.md#how-often-a-caller-may-try) | `AuthRateLimitOptions` | How often a caller may use the builtin login and password reset routes. 20 attempts in ten minutes by default |
| [`DPOP_NONCES`](./dpop.md) | `boolean` | Whether a [DPoP](./glossary.md#dpop) proof carries a nonce your application issued. `false` by default |
| [`DPOP_PROOF_MAX_AGE_IN_MS`](./dpop.md) | `number` | How far the time a DPoP proof was signed may be from now. Five minutes by default |
| [`DPOP_NONCE_LIFETIME_IN_MS`](./dpop.md#nonces) | `number` | How long a DPoP nonce works. Five minutes by default |
| [`COOKIE_AUTH_SESSION_OPTIONS`](./auth.md#naming-the-session-cookie) | `CookieAuthSessionOptionsInput` | The name and flags of the session cookie. `sessionId`, `sameSite: 'lax'` and `path: '/'` by default |
| [`COOKIE_AUTH_REFRESH_SESSION_OPTIONS`](./auth.md#setting-the-session-cookie-flags) | `CookieAuthSessionOptionsInput` | The name and flags of the refresh cookie. `refreshSessionId`, `sameSite: 'lax'` and `path: '/'` by default |
| [`COOKIE_AUTH_SESSION_EXPIRES_IN_MS`](./auth.md#how-long-a-login-lasts) | `number` | How long a session cookie lasts. A day by default |
| [`COOKIE_AUTH_REFRESH_SESSION_EXPIRES_IN_MS`](./auth.md#how-long-a-login-lasts) | `number` | How long a refresh cookie lasts. 30 days by default |
| [`COOKIE_AUTH_REFRESH_SESSION_REUSE_GRACE_IN_MS`](./auth.md#how-long-a-login-lasts) | `number` | How long a rotated refresh cookie is still taken. 30 seconds by default |
| [`COOKIE_AUTH_ROW_GRACE_IN_MS`](./auth.md#how-long-a-login-lasts) | `number` | How long the stored session outlives its cookie, for a clock that runs behind. Five minutes by default |
| [`CSRF_TOKEN_HEADER`](./auth.md#sending-the-csrf-token) | `string` | Which header carries the CSRF token. `x-csrf-token` by default |
| [`PASSWORD_RESET_TOKEN_EXPIRES_IN_MS`](./auth.md#how-long-a-login-lasts) | `number` | How long a password reset link works. Five minutes by default |
| [`API_KEY_HEADER`](./api-keys.md) | `string` | Which header carries an [API key](./glossary.md#api-key). `x-api-key` by default |
| [`API_KEY_OPTIONS`](./api-keys.md) | `ApiKeyOptions` | How long an expired key stays in the list, among the other options of a key. The defaults are listed on the page |

## Configuring the second factor

| Token | Type | What it is |
|---|---|---|
| [`TWO_FACTOR_FAILURE_DELAY_IN_MS`](./two-factor.md) | `number` | The wait after the first wrong code, doubling with each one after it. One second by default |
| [`REQUIRE_2FA_REAUTH`](./two-factor.md) | `Require2faReauth` | What a route that says nothing about `reauth` accepts. `false` by default |
| [`REQUIRE_2FA_REAUTH_WINDOW_IN_MS`](./two-factor.md) | `number` | How recent a login has to be to count. Five minutes by default |
| [`REQUIRE_2FA_PROVIDER_FACTORS`](./two-factor.md) | `Require2faProviderFactors` | What a route that says nothing about `providerFactors` counts. `false` by default |
| [`OTP_HEADER`](./two-factor.md) | `string` | Which header carries a one-time password. `x-authorization-otp` by default |
| [`OTP_VALIDATION_WINDOW_IN_MS`](./two-factor.md) | `OtpValidationWindowInMs` | How much clock skew a one-time password may have. 30 seconds by default |
| [`OTP_PERIOD_IN_SECONDS`](./two-factor.md#clock-skew) | `number` | How long an authenticator app shows one code. 30 seconds by default |
| `OTP_LENGTH` | `number` | How many digits a one-time password has. 6 by default |
| [`PASSKEY_HEADER`](./passkeys.md) | `string` | Which header carries a [passkey](./glossary.md#passkey) as a [second factor](./glossary.md#second-factor). `x-authorization-passkey` by default |
| [`EMAIL_CODE_HEADER`](./two-factor.md) | `string` | Which header carries a mailed code. `x-authorization-email-code` by default |
| [`SMS_CODE_HEADER`](./two-factor.md) | `string` | Which header carries a texted code. `x-authorization-sms-code` by default |
| [`RECOVERY_CODE_HEADER`](./two-factor.md) | `string` | Which header carries a recovery code. `x-authorization-recovery-code` by default |
| [`RECOVERY_CODE_OPTIONS`](./two-factor.md#recovery-codes) | `RecoveryCodeOptions` | How many recovery codes a set holds, and how long each is. 10 of 10 characters by default |
| [`LOGIN_TICKET_HEADER`](./two-factor.md) | `string` | Which header carries a login [ticket](./glossary.md#ticket). `x-login-ticket` by default |
| [`LOGIN_TICKET_EXPIRES_IN_MS`](./two-factor.md) | `number` | How long a login waits for its second factor. Five minutes by default |
| [`TWO_FACTOR_CODE_OPTIONS`](./two-factor.md) | `TwoFactorCodeOptions` | How many digits a mailed or texted code has, how long it lasts, how often one can be sent and how many wrong ones it takes. The defaults are listed on the page |

## Configuring encryption and hashing

| Token | Type | What it is |
|---|---|---|
| [`HASH_STRATEGIES`](./encryption-and-hashing.md) | `Newable<HashStrategyInterface>[]` | The hash algorithms, the first of them the default. `ScryptHashStrategy` and `Sha256HashStrategy` by default |
| [`SCRYPT_COST`](./encryption-and-hashing.md) | `ScryptCost` | What hashing one password costs. `defaultScryptCost` by default |
| [`ENCRYPTION_STRATEGIES`](./encryption-and-hashing.md) | `Newable<EncryptionStrategyInterface>[]` | The encryption algorithms. `AesGcmEncryptionStrategy` by default |

## Configuring the data source

| Token | Type | What it is |
|---|---|---|
| [`SCHEMA_LOCK_TIMEOUT_IN_MS`](./data-source.md) | `number` | How long an instance waits for the schema setup of another before it fails to start. A minute by default |
| `SCHEMA_LOCK_HOLD_IN_MS` | `number` | How long the schema setup of `ValKeyDataSource` may run before another instance may take it over. 30 seconds by default |
| `VAL_KEY_TRANSACTION_LOCK_TIMEOUT_IN_MS` | `number` | How long a transaction of `ValKeyDataSource` waits to start. Ten seconds by default |
| `VAL_KEY_TRANSACTION_LOCK_HOLD_IN_MS` | `number` | How long a transaction of `ValKeyDataSource` may run before another may start. 30 seconds by default |
| [`CACHE_INVALIDATION_RETENTION_IN_MS`](./caching.md) | `number` | How long the record of a cache invalidation is kept. A minute by default |
| [`LEASE_DRAIN_TIMEOUT_IN_MS`](./leases.md) | `number` | How long work holding a [lease](./glossary.md#lease) may take to finish on shutdown. Ten seconds by default |
| [`INSTANCE_ID`](./replication.md) | `string` | Names the instance on the leases it holds and the thread jobs it runs. The host name and the process id by default |
| [`REPOSITORY_HOOKS`](./data-source.md) | `RepositoryHooks` | Code every repository runs on every row it saves, deletes or returns. None by default |

## Configuring background work

| Token | Type | What it is |
|---|---|---|
| [`CRON_EXECUTION_LEASE_IN_MS`](./cron.md) | `number` | How long one run of a cron job holds its claim. Five minutes by default |
| [`CRON_REGISTRATION_LEASE_IN_MS`](./cron.md) | `number` | How long one instance may take to register its jobs at startup. 30 seconds by default |
| [`EVENT_EXECUTION_LEASE_IN_MS`](./events.md) | `number` | How long one run of a hook holds its claim. A minute by default |
| [`EVENT_SUBSCRIBER_REGISTRATION_TTL_IN_MS`](./events.md) | `number` | How long a subscriber stays on record without being refreshed. A minute by default |
| [`EVENT_RETRY_DELAY_IN_MS`](./events.md) | `number` | How long the first retry of a hook waits, doubling with each one after it. A minute by default |
| [`EVENT_MAX_CONCURRENT_HOOKS`](./events.md) | `number` | How many hooks one instance runs at a time. 50 by default |
| [`FRAMEWORK_EVENT_NAMES`](./events.md#hearing-of-users-memberships-and-roles) | `FrameworkEventNames` | Which writes of users, [memberships](./glossary.md#membership) and roles are emitted, as which of your events. None by default |
| [`MULTITHREADING_OPTIONS_INPUT`](./multithreading.md#configuration) | `MultithreadingOptionsInput` | How many workers run, how long a job may take, and whether a worker file may be TypeScript. Sized to the machine, with JavaScript worker files, by default |
| [`BACKUP_TEMP_FOLDER`](./backup.md) | `FsPath` | Where a backup is staged on its way to and from a transport. `.zibri/backups` in the application's root by default |
| [`BACKUP_SHUTDOWN_WAIT_IN_MS`](./backup.md) | `number` | How long the application waits for a running backup or restore when it stops. 0 by default |
| [`BACKUP_MAX_ATTEMPTS`](./backup.md#creating-and-restoring-backups) | `number` | How many times a resource of a backup is tried before the backup fails. 3 by default |
| [`BACKUP_RETRY_DELAY_IN_MS`](./backup.md#creating-and-restoring-backups) | `number` | How long the first retry of a resource waits, doubling for each one after it. One minute by default |
| [`BACKUP_RETENTION`](./backup.md#deleting-old-backups) | `BackupRetention \| undefined` | Which completed backups are kept each time a backup completes. None by default, which keeps every backup |

## Configuring pages, translations and outgoing requests

| Token | Type | What it is |
|---|---|---|
| [`ERROR_PAGE_TEMPLATE`](./error-handling.md#rendering-an-error-page) | `ErrorPageTemplate` | The page an error answers a browser with. None by default, and a browser is answered with JSON |
| [`LOCALIZE_OPTIONS_INPUT`](./localization.md) | `LocalizeOptionsInput` | The supported locales, the default locale and the default time zone. `en-US` and `UTC` by default |
| [`TRANSLATIONS_PATH`](./localization.md) | `FsPath` | Where translations are read from. `translations` beside the bundle by default |
| [`ASSETS_PATH`](./assets.md) | `FsPath` | Where assets are read from. `assets` beside the bundle by default |
| `HANDLEBAR_OPTIONS` | `HandlebarOptions` | The Handlebars instance and the folder of the components a Handlebars template uses. None by default |
| [`HTTP_CLIENT_OPTIONS_INPUT`](./http-client.md) | `HttpClientOptionsInput` | The timeout, response size limit, circuit breaker and redirects of outgoing requests. Five seconds, ten megabytes, open for 30 seconds after 5 failures, and following redirects except from https to http, by default |
| [`TRACE_BUFFER`](./tracing.md) | `TraceBufferInterface` | Where recorded spans are kept. An `InMemoryTraceBuffer` of a thousand spans by default |
| [`TRACE_EXPORTER`](./tracing.md) | `OpenTelemetrySpanExporter` | Where finished spans are sent. Nowhere by default |

## Replacing a service
Every service is provided under a token. Provide your own implementation of its interface under the
token to replace it.

| Token | Type | What it is |
|---|---|---|
| [`ROUTER`](./auth.md#protecting-manually-registered-routes) | `RouterInterface` | Registers the routes and answers the requests. `Router` by default |
| [`LOGGER`](./logging.md) | `LoggerInterface` | Writes log entries. `Logger` by default |
| [`AUDIT_SERVICE`](./audit.md) | `AuditServiceInterface` | Records and reads audit entries. `AuditService` by default |
| [`CHAIN_SERVICE`](./tamper-evident-tables.md) | `ChainServiceInterface` | Links the rows of chained entities, checks and prunes their chains. `ChainService` by default |
| [`METRICS_SERVICE`](./metrics.md) | `MetricsServiceInterface` | Collects metrics. `PrometheusMetricsService` by default |
| [`ASSET_SERVICE`](./assets.md) | `AssetServiceInterface` | Serves and reads assets. `AssetService` by default |
| [`BACKUP_SERVICE`](./backup.md) | `BackupServiceInterface` | Writes and restores backups. `BackupService` by default |
| [`GLOBAL_ERROR_HANDLER`](./error-handling.md) | `GlobalErrorHandler` | Answers a request whose handler threw. The built-in handler by default |
| [`OPEN_API_SERVICE`](./open-api.md) | `OpenApiServiceInterface` | Builds the OpenAPI documents and serves the explorer. `OpenApiService` by default |
| [`AUTH_SERVICE`](./auth.md) | `AuthServiceInterface` | Logs users in and out. `AuthService` by default |
| [`ROUTE_AUTH_SERVICE`](./auth.md) | `RouteAuthServiceInterface` | Resolves what each route requires of a caller. `RouteAuthService` by default |
| [`ROLE_SERVICE`](./roles-and-permissions.md) | `RoleServiceInterface` | Reads, creates, changes, gives and takes roles. `RoleService` by default |
| [`AUTHORIZATION_SERVER_SERVICE`](./authorization-server.md) | `AuthorizationServerServiceInterface` | Answers the routes of the authorization server. `AuthorizationServerService` by default |
| [`AUTH_RATE_LIMITER`](./auth.md) | `RateLimiterInterface` | Limits login attempts. `AuthRateLimiter` by default |
| [`TWO_FACTOR_SERVICE`](./two-factor.md) | `TwoFactorServiceInterface` | Checks and manages second factors. `TwoFactorService` by default |
| [`API_KEY_SERVICE`](./api-keys.md) | `ApiKeyServiceInterface` | Issues, reads and revokes API keys. `ApiKeyService` by default |
| [`SCIM_SERVICE`](./scim.md) | `ScimServiceInterface` | Answers the [SCIM](./glossary.md#scim) routes. `ScimService` by default |
| `PARSER` | `ParserInterface` | Parses request bodies and parameters. `Parser` by default |
| [`VALIDATION_SERVICE`](./validation.md#replacing-the-validation) | `ValidationServiceInterface` | Validates values against their models. `ValidationService` by default |
| `DATA_SOURCE_SERVICE` | `DataSourceServiceInterface` | Starts and stops the data sources. `DataSourceService` by default |
| [`LEASE_SERVICE`](./leases.md) | `LeaseServiceInterface` | Takes and releases leases. `LeaseService` by default |
| [`WAKE_UP_SERVICE`](./cron.md) | `WakeUpServiceInterface` | Wakes the instances waiting for work on a topic. `WakeUpService` by default |
| [`TENANT_SERVICE`](./tenancy.md) | `TenantServiceInterface` | Creates and reads [tenants](./glossary.md#tenant). `TenantService` by default |
| [`MEMBERSHIP_SERVICE`](./tenancy.md) | `MembershipServiceInterface` | Adds users to tenants and removes them. `MembershipService` by default |
| [`JWT_SERVICE`](./auth.md) | `JwtServiceInterface` | Signs and verifies access tokens. `JwtService` by default |
| [`DPOP_SERVICE`](./dpop.md) | `DpopServiceInterface` | Checks DPoP proofs. `DpopService` by default |
| [`PASSKEY_SERVICE`](./passkeys.md) | `PasskeyServiceInterface` | Creates and checks passkeys. `PasskeyService` by default |
| [`FIDO_METADATA_SERVICE`](./passkeys.md) | `FidoMetadataServiceInterface` | Reads what the FIDO Metadata Service says about a device. `FidoMetadataService` by default |
| `USER_SERVICE` | `UserServiceInterface` | Reads and changes users. `UserService` by default |
| [`CRON_SERVICE`](./cron.md) | `CronServiceInterface` | Schedules and runs cron jobs. `CronService` by default |
| [`EMAIL_SERVICE`](./email.md) | `EmailServiceInterface` | Queues and sends emails. `EmailService` by default |
| `EMAIL_RATE_LIMITER` | `RateLimiterInterface` | Limits how many emails are sent, to the rate of `EMAIL_CONFIG` |
| [`MULTITHREADING_SERVICE`](./multithreading.md) | `MultithreadingServiceInterface` | Runs jobs in worker threads. `MultithreadingService` by default |
| [`WEBSOCKET_SERVICE`](./websocket.md) | `WebsocketServiceInterface` | Runs the websocket server. `WebsocketService` by default |
| [`HTTP_CLIENT`](./http-client.md) | `HttpClientInterface` | Sends outgoing requests. `HttpClient` by default |
| [`EVENT_SERVICE`](./events.md) | `EventServiceInterface` | Emits events and runs their hooks. `EventService` by default |
| [`TRACER`](./tracing.md) | `TracerInterface` | Records spans. `OpenTelemetryTracer` by default |
| [`HASH_SERVICE`](./encryption-and-hashing.md) | `HashServiceInterface` | Hashes and verifies values. `HashService` by default |
| [`ENCRYPTION_SERVICE`](./encryption-and-hashing.md) | `EncryptionServiceInterface` | Encrypts and decrypts values, and keeps the keys. `EncryptionService` by default |
| `ENCRYPTION_KEY_CACHE` | `WriteThroughReadThroughCache` | Keeps the encryption keys a process has read |
| [`CACHE_SERVICE`](./caching.md) | `CacheServiceInterface` | Keeps and invalidates the caches. `CacheService` by default |
| `VERSIONING_SERVICE` | `VersioningServiceInterface` | Finds the version a request asks for, and records the routes of each version. `VersioningService` by default |
| [`LOCALIZE_SERVICE`](./localization.md) | `LocalizeServiceInterface` | Finds the locale of a request, and translates and formats. `LocalizeService` by default |
| [`RATE_LIMITING_SERVICE`](./rate-limiting.md) | `RateLimitingServiceInterface` | Runs the rate limiters. `RateLimitingService` by default |

## Reading what is in effect
These are read, not provided.

| Token | Type | What it is |
|---|---|---|
| `JWT_AUTH_OPTIONS` | `JwtAuthOptions` | `JWT_AUTH_OPTIONS_INPUT` merged over the defaults |
| `LOCALIZE_OPTIONS` | `LocalizeOptions` | `LOCALIZE_OPTIONS_INPUT` merged over the defaults |
| `MULTITHREADING_OPTIONS` | `MultithreadingOptions` | `MULTITHREADING_OPTIONS_INPUT` merged over the defaults |
| `HTTP_CLIENT_OPTIONS` | `HttpClientOptions` | `HTTP_CLIENT_OPTIONS_INPUT` merged over the defaults |
| [`WEBSOCKET_OPTIONS`](./websocket.md) | `WebsocketOptions` | `WEBSOCKET_OPTIONS_INPUT` merged over the defaults. `undefined` for an application without websockets |
| `DEFAULT_CSP_OPTIONS` | `CspOptions` | `DEFAULT_CSP_OPTIONS_INPUT` merged over the defaults |
| `ZIBRI_PACKAGE_ROOT` | `FsPath` | The folder `zibri` is installed in |
| [`CURRENT_REQUEST_CONTEXT`](./request-context.md) | `HttpRequestContext \| WebsocketRequestContext` | The request being answered. `undefined` outside of one |
| [`CURRENT_CACHE_CONTEXT`](./request-context.md) | `CacheContext[]` | The caches being written in this call. `undefined` outside of one |

## See also
- [Dependency injection](./di.md) — providing values and replacing services
- [Plugins](./plugin.md) — the built-in plugins, each with its own tokens
- [The generated project](./project-layout.md) — the tokens `zi new` provides for you
- [Testing](./testing.md) — the tokens a test server provides in place of yours
