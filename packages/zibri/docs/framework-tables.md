# Framework tables
Every feature of Zibri that stores rows keeps them in a table of its own entity. This page says of each one what makes the table grow and what deletes its rows, so whoever approves the schema can plan how large it gets. Which feature needs which entity, and when, is in the Requirements of the feature's page.

## Sizing the tables
A cleanup cron job is registered for you with the feature that needs it. An expiry is honored by every read, and the job named beside it deletes the expired rows. A row deleted with its user goes in the same transaction that deletes the user for good. A [soft deleted](./glossary.md#soft-delete) user keeps their rows, and gets them back with a restore.

| Entity | Grows with | Rows end |
|---|---|---|
| `PasswordCredentials` | One row per user with a password, see [auth](./auth.md) | Deleted with its user |
| `PasswordResetToken` | At most one row per user who asked for a password reset | Deleted when it is used, with its user, and hourly by `ExpiredRowsCleanupCronJob` once expired |
| `EmailVerificationToken` | One row per link to [verify an address](./email-verification.md) a user was mailed, at most one live of each kind | Deleted when it is used, with its user, and hourly by `ExpiredRowsCleanupCronJob` once expired |
| `PasswordFailureStreak` | One row per user whose last logins had a wrong password, see [locking an account](./auth.md#locking-an-account-after-too-many-wrong-passwords) | Deleted at the next right password or password reset, and with its user |
| `JwtRefreshToken` | One row per JWT login, with the `User-Agent` and address of the client that last used it | Deleted at logout, with its user, and hourly by `ExpiredRowsCleanupCronJob` once expired |
| `JwtRevokedAccessToken` | One row per revoked access token, see [authorization server](./authorization-server.md) | Hourly by `ExpiredRowsCleanupCronJob` once the token expired |
| `CookieAuthSession`, `CookieAuthRefreshSession` | One row per cookie login, the refresh session with the `User-Agent` and address of the client that last used it | Deleted at logout, with its user, and hourly by `ExpiredRowsCleanupCronJob` once expired |
| `ApiKey` | One row per [API key](./api-keys.md) a user creates | Deleted when it is revoked, and with its user. An expired key goes `deleteExpiredAfterInMs` after it expired, 30 days by default, by `ApiKeyCleanupCronJob` hourly. A key without an expiry is kept until it is revoked |
| `LoginTicket` | One row per login that waits for its [second factor](./two-factor.md#asking-for-a-second-factor-at-login) | Deleted with its user, and hourly by `ExpiredRowsCleanupCronJob` once expired |
| `TwoFactorFailureStreak` | One row per user whose last second factors were wrong | Deleted at the next right second factor, and with its user |
| `OtpCredentials`, `TwoFactorCodeCredentials`, `TwoFactorRecoveryCode` | One row per second factor a user registers, and one per recovery code | Deleted when the registration is removed, and with its user. One that was never confirmed goes with the next registration |
| `TwoFactorCode` | One row per code sent by mail or text message | Deleted with its user, and hourly by `ExpiredRowsCleanupCronJob` once expired |
| `Passkey` | One row per [passkey](./passkeys.md) of a user | Deleted when it is removed, and with its user |
| `PasskeyChallenge`, `PasskeyRegistrationTicket` | One row per passkey login, registration or addition started | Deleted with the user it is for, and hourly by `PasskeyCleanupCronJob` once expired |
| `FederatedIdentity` | One row per account at a provider linked to a user, see [login through a provider](./login-through-a-provider.md) | Deleted when the identity is unlinked, and with its user |
| `OAuthProviderTokens` | One row per linked identity with access to the provider's APIs | Deleted when that access is revoked, the identity unlinked or its user deleted |
| `FederatedLoginAttempt`, `FederatedHandoverCode`, `FederatedRegistrationTicket`, `FederatedConnectionCode` | One row per login or link at a provider started | Deleted with the user it is for, and hourly by `ExpiredRowsCleanupCronJob` once expired |
| `LdapIdentity` | One row per directory entry that logged in, see [login through a directory](./login-through-a-directory.md) | Deleted with its user |
| `ScimUser`, `ScimUserValue`, `ScimGroup`, `ScimGroupMember` | One row per user, attribute value, group and member an identity provider provisions, see [SCIM](./scim.md) | Deleted when the identity provider deletes the resource |
| `AuditEntry` | Every audited action, with repeats of one collapsed into a row, see [audit](./audit.md) | Daily by `AuditCleanupCronJob` with the checkpoint sealing it, once its span ended longer ago than `AUDIT_RETENTION_IN_MS`, which has no default, or kept for good with `'forever'` |
| `AuditCheckpoint` | One row per [tenant](./glossary.md#tenant) and run of `AuditCheckpointCronJob` after it stored audit entries | Deleted with the entries it seals |
| `ChainedAuditEntry` | Every audited action of a trail [kept as a chain](./audit.md#keeping-the-trail-as-a-chain) | Daily by `AuditCleanupCronJob` from the start of each tenant's chain, once older than `AUDIT_RETENTION_IN_MS` |
| `ChainAnchor` | One row per chain whose oldest rows were pruned, see [tamper-evident tables](./tamper-evident-tables.md) | Kept for good |
| `SigningKey` | One row per [signing key](./encryption-and-hashing.md#keeping-a-signing-key) | Kept for good |
| `Log` | Every log line the database transport writes, at most 1000 a minute, see [logging](./logging.md) | Hourly by `ExpiredRowsCleanupCronJob` once older than `LOGGER_CLEANUP_AFTER_IN_MS` for its level, two weeks by default |
| `Email` | Every mail queued, see [what happens to the row](./email.md#what-happens-to-the-row) | Deleted once it is sent, or kept for good with `persist`. A failed one goes daily by `EmailCleanupCronJob` once older than `failedRetentionInMs`, which has no default |
| `Event` | Every event emitted, see [events](./events.md#when-an-event-cannot-be-handled) | Daily by `EventCleanupCronJob`: a finished one after the `cleanupAfterInMs` it was emitted with, a day by default, a failed one once older than `EVENT_FAILED_RETENTION_IN_MS`, which has no default |
| `EventSubscriberRun` | One row per subscriber that owes an event a run | Deleted with its event |
| `EventSubscriberRegistration` | One row per subscriber and event type the instances host | Deleted once no instance refreshed it for `EVENT_SUBSCRIBER_REGISTRATION_TTL_IN_MS`, a minute by default |
| `ThreadJobEntity` | Every thread job queued, see [multithreading](./multithreading.md#what-happens-to-a-finished-job) | Daily by `ThreadJobCleanupCronJob` once it is over and older than `THREAD_JOB_RETENTION_IN_MS`, which has no default |
| `CronJobEntity` | One row per [cron job](./cron.md) the application registers | Kept for good, also for a job the application stops registering |
| `Lease` | One row per key a [lease](./leases.md) is taken on | Hourly by `ExpiredRowsCleanupCronJob` once expired |
| `CacheInvalidation` | Every invalidation of a cache, see [caching](./caching.md) | Deleted by `CacheInvalidationCronJob`, every two seconds, once older than `CACHE_INVALIDATION_RETENTION_IN_MS`, a minute by default |
| `RateLimitStateEntity` | One row per key a rate limiter of the repository store counts, see [rate limiting](./rate-limiting.md) | Deleted by `RateLimitingCleanupCronJob`, every ten seconds, once expired |
| `WebsocketMessage` | Every message sent to a websocket channel, see [websockets](./websocket.md) | Hourly by `WebsocketMessageCleanupCronJob` once older than `messageRetentionInMs`, which has no default |
| `WebsocketChannel` | One row per channel your application creates | Deleted by your application |
| `WebsocketMessageSequence` | One row | Kept for good |
| `MigrationEntity` | One row per migration applied, see [data source](./data-source.md) | Kept for good |
| `ChangeSet`, `Change` | One row per write to a [change set](./glossary.md#change-set) entity, and one per property it changed | Deleted with the row they describe |
| `BackupEntity`, `BackupResourceEntity` | One row per [backup](./backup.md), and one per resource it holds | Deleted when the backup is deleted, by you or by the [retention](./backup.md#deleting-old-backups) |
| `HashStrategyEntity`, `EncryptionStrategyEntity` | One row per hash or encryption strategy, see [encryption and hashing](./encryption-and-hashing.md) | Kept for good |
| `EncryptionKey` | One row per encryption key | Deleted when you delete the key, once a rotation moved every value off it |
| `EncryptionRotationProgress` | One row | Kept for good |
| `EncryptionRotationFailure` | One row per stored row a rotation could not rewrite | Deleted once the row is rewritten or deleted |
| `Invoice`, `NumberInvoices`, `InvoiceRecipientAbbreviation` | One row per invoice, per [tenant](./tenancy.md) and year, and per recipient, see [invoicing](./invoicing-plugin.md) | Kept for good |
| `Payment` | One row per payment, see [payments](./payment-plugin.md) | Kept for good |
| `MailingList` | One row per list your application creates, see [mailing lists](./mailing-list-plugin.md) | Deleted by your application |
| `MailingListSubscriber` | One row per address on at least one list | Deleted when the address leaves its last list: by unsubscribing, on the preferences page, or with `deleteList` |
| `MailingListSubscriptionConfirmationToken` | One row per subscription waiting to be confirmed | Hourly by `ExpiredRowsCleanupCronJob` once expired |

## See also
- [Data source](./data-source.md) — declaring the entities of a data source
- [Configuration](./configuration.md) — every retention token and its default
- [Cron jobs](./cron.md) — when the cleanup jobs run, and changing their schedule
