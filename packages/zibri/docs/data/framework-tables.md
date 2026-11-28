---
keywords: [tables, schema, built in entities, internal tables]
---

# Framework tables
Every feature of Zibri that stores rows keeps them in a table of its own entity. This page says of each one what makes the table grow and what deletes its rows, so whoever approves the schema can plan how large it gets. Which feature needs which entity, and when, is in the Requirements of the feature's page.

## Sizing the tables
A cleanup cron job is registered for you with the feature that needs it. An expiry is honored by every read, and the job named beside it deletes the expired rows. A row deleted with its user goes in the same transaction that deletes the user for good. A [soft deleted](../glossary.md#soft-delete) user keeps their rows, and gets them back with a restore.

| Entity | Grows with | Rows end |
|---|---|---|
| `PasswordCredentials` | One row per user with a password, see [auth](../auth/auth.md) | Deleted with its user |
| `PasswordResetToken` | At most one row per user who asked for a password reset | Deleted when it is used, with its user, and hourly by `ExpiredRowsCleanupCronJob` once expired |
| `LoginLinkToken` | At most one row per user who asked for a [link to log in with](../auth/login-links.md), and one per invitation without a password being accepted | Deleted when it is used, with its user, and hourly by `ExpiredRowsCleanupCronJob` once expired |
| `EmailVerificationToken` | One row per link to [verify an address](../auth/email-verification.md) a user was mailed, at most one live of each kind | Deleted when it is used, with its user, and hourly by `ExpiredRowsCleanupCronJob` once expired |
| `PasswordFailureStreak` | One row per user whose last logins had a wrong password, see [locking an account](../auth/auth.md#locking-an-account-after-too-many-wrong-passwords) | Deleted at the next right password or password reset, and with its user |
| `JwtRefreshToken` | One row per JWT login, with the `User-Agent` and address of the client that last used it | Deleted at logout, with its user, and hourly by `ExpiredRowsCleanupCronJob` once expired |
| `JwtRevokedAccessToken` | One row per revoked access token, see [authorization server](../auth/authorization-server.md) | Hourly by `ExpiredRowsCleanupCronJob` once the token expired |
| `CookieAuthSession`, `CookieAuthRefreshSession` | One row per cookie login, the refresh session with the `User-Agent` and address of the client that last used it | Deleted at logout, with its user, and hourly by `ExpiredRowsCleanupCronJob` once expired |
| `ApiKey` | One row per [API key](../auth/api-keys.md) a user creates | Deleted when it is revoked, and with its user. An expired key goes `deleteExpiredAfterInMs` after it expired, 30 days by default, by `ApiKeyCleanupCronJob` hourly. A key without an expiry is kept until it is revoked |
| `LoginTicket` | One row per login that waits for its [second factor](../auth/two-factor.md#asking-for-a-second-factor-at-login) | Deleted with its user, and hourly by `ExpiredRowsCleanupCronJob` once expired |
| `TwoFactorFailureStreak` | One row per user whose last second factors were wrong | Deleted at the next right second factor, and with its user |
| `OtpCredentials`, `TwoFactorCodeCredentials`, `TwoFactorRecoveryCode` | One row per second factor a user registers, and one per recovery code | Deleted when the registration is removed, and with its user. One that was never confirmed goes with the next registration |
| `TwoFactorCode` | One row per code sent by mail or text message | Deleted with its user, and hourly by `ExpiredRowsCleanupCronJob` once expired |
| `Passkey` | One row per [passkey](../auth/passkeys.md) of a user | Deleted when it is removed, and with its user |
| `PasskeyChallenge`, `PasskeyRegistrationTicket` | One row per passkey login, registration or addition started | Deleted with the user it is for, and hourly by `PasskeyCleanupCronJob` once expired |
| `FederatedIdentity` | One row per account at a provider linked to a user, see [login through a provider](../auth/login-through-a-provider.md) | Deleted when the identity is unlinked, and with its user |
| `OAuthProviderTokens` | One row per linked identity with access to the provider's APIs | Deleted when that access is revoked, the identity unlinked or its user deleted |
| `FederatedLoginAttempt`, `FederatedHandoverCode`, `FederatedRegistrationTicket`, `FederatedConnectionCode` | One row per login or link at a provider started | Deleted with the user it is for, and hourly by `ExpiredRowsCleanupCronJob` once expired |
| `LdapIdentity` | One row per directory entry that logged in, see [login through a directory](../auth/login-through-a-directory.md) | Deleted with its user |
| `ScimUser`, `ScimUserValue`, `ScimGroup`, `ScimGroupMember` | One row per user, attribute value, group and member an identity provider provisions, see [SCIM](../auth/scim.md) | Deleted when the identity provider deletes the resource |
| `AuditEntry` | Every audited action, with repeats of one collapsed into a row, see [audit](./audit.md) | Daily by `AuditCleanupCronJob` with the checkpoint sealing it, once its span ended longer ago than `AUDIT_RETENTION_IN_MS`, which has no default, or kept for good with `'forever'` |
| `AuditCheckpoint` | One row per [tenant](../glossary.md#tenant) and run of `AuditCheckpointCronJob` after it stored audit entries | Deleted with the entries it seals |
| `ChainedAuditEntry` | Every audited action of a trail [kept as a chain](./audit.md#keeping-the-trail-as-a-chain) | Daily by `AuditCleanupCronJob` from the start of each tenant's chain, once older than `AUDIT_RETENTION_IN_MS` |
| `ChainAnchor` | One row per chain whose oldest rows were pruned, see [tamper-evident tables](./tamper-evident-tables.md) | Kept for good |
| `ChainGap` | One row per [archived](./archive.md) row deleted from inside its chain once its retention ended | Deleted once every row before it in its chain is deleted, when the start of the chain moves past it |
| `SigningKey` | One row per [signing key](./encryption-and-hashing.md#keeping-a-signing-key) | Kept for good |
| `Log` | Every log line the database transport writes, at most 1000 a minute, see [logging](../operations/logging.md) | Hourly by `ExpiredRowsCleanupCronJob` once older than `LOGGER_CLEANUP_AFTER_IN_MS` for its level, two weeks by default |
| `Email` | Every mail queued, see [what happens to the row](../templates/email.md#what-happens-to-the-row) | Deleted once it is sent, or kept for good with `persist`. A failed one goes daily by `EmailCleanupCronJob` once older than `failedRetentionInMs`, which has no default |
| `Event` | Every event emitted, see [events](../background-work/events.md#when-an-event-cannot-be-handled) | Daily by `EventCleanupCronJob`: a finished one after the `cleanupAfterInMs` it was emitted with, a day by default, a failed one once older than `EVENT_FAILED_RETENTION_IN_MS`, which has no default |
| `EventSubscriberRun` | One row per subscriber that owes an event a run | Deleted with its event |
| `TenantDeletion` | One row per tenant whose [deletion](./tenancy.md#deleting-a-tenant) was started | Kept for good, as the record that the tenant was deleted |
| `RowShare` | One row per row of a shareable entity and user it is [shared with](./sharing.md) | Deleted when it is unshared, with its row and the rows deleted along with it, and with its user |
| `EventSubscriberRegistration` | One row per subscriber and event type the instances host | Deleted once no instance refreshed it for `EVENT_SUBSCRIBER_REGISTRATION_TTL_IN_MS`, a minute by default |
| `ThreadJobEntity` | Every thread job queued, see [multithreading](../background-work/multithreading.md#what-happens-to-a-finished-job) | Daily by `ThreadJobCleanupCronJob` once it is over and older than `THREAD_JOB_RETENTION_IN_MS`, which has no default |
| `CronJobEntity` | One row per [cron job](../background-work/cron.md) the application registers | Kept for good, also for a job the application stops registering |
| `Lease` | One row per key a [lease](./leases.md) is taken on | Hourly by `ExpiredRowsCleanupCronJob` once expired |
| `CacheInvalidation` | Every invalidation of a cache, see [caching](./caching.md) | Deleted by `CacheInvalidationCronJob`, every two seconds, once older than `CACHE_INVALIDATION_RETENTION_IN_MS`, a minute by default |
| `RateLimitStateEntity` | One row per key a rate limiter of the repository store counts, see [rate limiting](../endpoints/rate-limiting.md) | Deleted by `RateLimitingCleanupCronJob`, every ten seconds, once expired |
| `WebsocketMessage` | Every message sent to a websocket channel, see [websockets](../endpoints/websocket.md) | Hourly by `WebsocketMessageCleanupCronJob` once older than `messageRetentionInMs`, which has no default |
| `WebsocketChannel` | One row per channel your application creates, and one per user and board they [receive the changes of](../plugins/projects-plugin.md#updating-a-board-live) | Deleted by your application. One of a board goes with the first change its user does not see the project at |
| `WebsocketMessageSequence` | One row | Kept for good |
| `MigrationEntity` | One row per migration applied, see [data source](./data-source.md) | Kept for good |
| `ChangeSet`, `Change` | One row per write to a [change set](../glossary.md#change-set) entity, and one per property it changed | Deleted with the row they describe |
| `BackupEntity`, `BackupResourceEntity` | One row per [backup](./backup.md), and one per resource it holds | Deleted when the backup is deleted, by you or by the [retention](./backup.md#deleting-old-backups) |
| `TenantBackupTransport` | One row per transport a tenant [keeps its backups on](./backup.md#letting-a-tenant-back-up-to-its-own-storage) | Deleted by `deleteTenantBackupTransport` |
| `TenantBackupSettings` | One row per tenant that set a retention of its own | Kept while the tenant is |
| `FileRecord` | One row per [file stored](./files.md), however many share their bytes | Deleted by `delete` of the file service. Its bytes go with the last row of the same content, see [keeping the same content once](./files.md#keeping-the-same-content-once) |
| `TenantFileStore` | One row per store a tenant [keeps its files in](./files.md#letting-a-tenant-keep-its-files-in-its-own-storage) | Deleted by `deleteTenantFileStore` |
| `TenantWebDavConnection` | One row per WebDAV folder a tenant [connects your application to](../endpoints/web-dav.md#connecting-to-the-server-of-a-tenant) | Deleted by your application |
| `CalendarEntryLink` | One row per row [synced into a calendar](../endpoints/calendar-sync.md) and calendar it is in | Deleted by `removeEntry` of the calendar sync service, and with the [connection](../endpoints/web-dav.md#keeping-a-connection-that-is-in-use) the entry was written through |
| `MirroredFile` | One row per file [mirrored into a folder](../endpoints/file-mirror.md), per connection and path | With the [connection](../endpoints/web-dav.md#keeping-a-connection-that-is-in-use) it was mirrored through. Otherwise kept, as the files in the folder are |
| `FileMirrorRequest` | One row per call of `mirrorFile`, with the content of the file, until it is written | Deleted by `FileMirrorCronJob` once the file, or a later version of it, is written. One that spent its attempts is kept until a later version of the same path is written, and with its connection |
| `FileMirrorShareLink` | One row per path a [share link](../endpoints/file-mirror.md#sharing-a-folder-by-link) was asked for, per connection | With its connection. Otherwise kept, and reused while Nextcloud has the share |
| `BackupChunkEntity` | One row per [chunk](./backup.md#storing-unchanged-data-once) a transport holds: about one per MiB of data that changed, per transport | Deleted by `BackupGarbageCollectionCronJob`, once a day, with the chunks no backup names, and once the transport is found not to hold them, see [freeing the space of deleted backups](./backup.md#freeing-the-space-of-deleted-backups) |
| `HashStrategyEntity`, `EncryptionStrategyEntity` | One row per hash or encryption strategy, see [encryption and hashing](./encryption-and-hashing.md) | Kept for good |
| `EncryptionKey` | One row per encryption key | Deleted when you delete the key, once a rotation moved every value off it |
| `EncryptionRotationProgress` | One row | Kept for good |
| `EncryptionRotationFailure` | One row per stored row a rotation could not rewrite | Deleted once the row is rewritten or deleted |
| `Invoice`, `NumberInvoices`, `InvoiceRecipientAbbreviation` | One row per invoice and credit note, per [tenant](./tenancy.md) and number scope, such as a year and recipient, and per recipient, see [invoicing](../plugins/invoicing-plugin.md) | Kept for good |
| `Payment` | One row per payment, see [payments](../plugins/payment-plugin.md) | Kept for good |
| `MailingList` | One row per list your application creates, see [mailing lists](../plugins/mailing-list-plugin.md) | Deleted by your application |
| `MailingListSubscriber` | One row per address on at least one list | Deleted when the address leaves its last list: by unsubscribing, on the preferences page, or with `deleteList` |
| `MailingListSubscriptionConfirmationToken` | One row per subscription waiting to be confirmed | Hourly by `ExpiredRowsCleanupCronJob` once expired |
| `AnalyticsSite` | One row per site counted, of your application or of a tenant, see [analytics](../plugins/analytics-plugin.md#adding-the-sites) | Deleted through `DELETE /sites/:id`, `deleteSite` or with its tenant |
| `AnalyticsPageViewRecord`, `AnalyticsEventRecord` | One row per page view and per event of the sites counted, see [analytics](../plugins/analytics-plugin.md) | Daily by `AnalyticsCleanupCronJob` once its day is older than `retentionInMs`, two years by default, or kept for good with `'forever'`, and with its tenant |
| `BankAccount` | One row per bank account of a [tenant](./tenancy.md), see [importing bank statements](../plugins/bank-plugin.md) | Deleted by your application |
| `BankStatement` | One row per statement imported, with its original file | Once its retention ended, 8 years from the end of its year by default, by `prune` of the archive service or `ArchivePruneCronJob`, see [pruning the archive](./archive.md#pruning-the-archive) |
| `BankTransaction` | One row per booked transaction of an account, however many statements hold it | Kept for good |
| `BankTransactionState` | One row per transaction, what of it is left to match, see [keeping what is left to match](../plugins/bank-plugin.md#keeping-what-is-left-to-match) | Kept for good |
| `BankMatch` | One row per part of a transaction confirmed as paying an invoice or an expense, or booked against an account, and per match reversing one, see [matching transactions with invoices](../plugins/bank-plugin.md#matching-transactions-with-invoices) | Kept for good |
| `BookkeepingSettings`, `BookkeepingAccount` | One row per tenant keeping books, and per account of its books, see [keeping the books](../plugins/bookkeeping-plugin.md) | Deleted by your application |
| `FiscalYear`, `PostingRuleSet` | One row per fiscal year of the books of a tenant, see [adding fiscal years](../plugins/bookkeeping-plugin.md#adding-fiscal-years), and per set of posting rules of each, see [setting the posting rules](../plugins/bookkeeping-plugin.md#setting-the-posting-rules) | Deleted by your application |
| `JournalEntry`, `JournalEntryLine` | One row per entry posted and per line of each, in a chain per tenant each | Once its retention ended, 10 years from the end of the calendar year its fiscal year ends in by default, by `prune` of the archive service or `ArchivePruneCronJob`, see [pruning the archive](./archive.md#pruning-the-archive) |
| `Expense` | One row per expense of a tenant and per correction of one, see [recording an expense](../plugins/bookkeeping-plugin.md#recording-an-expense) | A draft through `DELETE /expenses/:id`, a recorded one kept for good |
| `ExpenseReceipt` | One row per receipt uploaded, with its file | Once its retention ended, 8 years from the end of the year it was uploaded in by default, by `prune` of the archive service or `ArchivePruneCronJob`, see [pruning the archive](./archive.md#pruning-the-archive) |
| `InvoiceDocument` | One row per invoice and credit note issued with `archive` of the invoicing options, with its pdf and the xml of its electronic invoice | Once its retention ended, 8 years from the end of the year the invoice was issued in by default, by `prune` of the archive service or `ArchivePruneCronJob`, see [pruning the archive](./archive.md#pruning-the-archive) |
| `FiscalYearStatement` | Up to four rows per closed fiscal year, the balance sheet and the income statement in the forms that applied and in the full forms, each with its pdf | Once its retention ended, 10 years from the end of the calendar year its fiscal year ends in by default, by `prune` of the archive service or `ArchivePruneCronJob`, see [pruning the archive](./archive.md#pruning-the-archive) |
| `EBilanzSettings` | At most one row per tenant keeping books, with the company of its E-Bilanz and its ELSTER certificate | Never: the row stays as long as the tenant |
| `EBilanzAccountMapping` | One row per account mapped to a position of the taxonomy of its own, see [mapping an account of its own](../plugins/e-bilanz.md#mapping-an-account-of-its-own) | When the mapping is removed |
| `EBilanzFiling` | A few rows per closed fiscal year: each preparation of its E-Bilanz with its content, each transmission and each filing by hand, with its protocol | Once its retention ended, 10 years from the end of the calendar year its fiscal year ends in by default, by `prune` of the archive service or `ArchivePruneCronJob`, see [pruning the archive](./archive.md#pruning-the-archive) |
| `AccountMatchRule` | One row per rule suggesting an account a bank transaction is matched with, see [matching transactions with accounts](../plugins/bookkeeping-plugin.md#matching-transactions-with-accounts) | Through `DELETE /account-match-rules/:id` |
| `ApprovalRequest` | One row per action proposed for approval, see [approving actions](../plugins/approval-plugin.md) | Kept for good, closed as `EXPIRED` once it waited its `expiresInMs` |
| `ApprovalDecision` | One row per request approved or rejected, in a chain per tenant | Kept for good |
| `Project` | One row per project of a tenant, see [managing projects and tasks](../plugins/projects-plugin.md) | Through `DELETE /:projectId`, with the projects below it |
| `ProjectColumn`, `TaskLabel` | One row per column of the board of a project, and per label of a project | Through their `DELETE` route, and with their project |
| `Task`, `TaskComment` | One row per task of a project, and per comment on a task | Through their `DELETE` route, the comments with their task, and both with their project |
| `RecurringTask` | One row per [recurring task](../plugins/projects-plugin.md#repeating-a-task) of a project | Through its `DELETE` route, and with its project |
| `RecurringTaskOccurrence` | One row per occurrence of a recurring task created, also once its task is deleted | With its recurring task |
| `ProjectCalendarDefaults` | One row per tenant that set a [working calendar](../plugins/projects-plugin.md#keeping-due-dates-to-working-days) of its own | Deleted by your application |
| `TaskCalendarSyncRequest` | One row per change of a task with a due date, or of the calendar of a project or the tenant, not [written into the calendar](../plugins/projects-plugin.md#writing-due-dates-into-a-calendar) yet | Deleted by `TaskCalendarSyncCronJob` once the change is written. One that spent its attempts is kept until a later change of the same task, project or tenant is written |

## See also
- [Data source](./data-source.md) — declaring the entities of a data source
- [Configuration](../application/configuration.md) — every retention token and its default
- [Cron jobs](../background-work/cron.md) — when the cleanup jobs run, and changing their schedule
