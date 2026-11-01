# Upgrading to 3
Most of what 3.0.0 changes, the compiler tells you about: removed exports, renamed options, options that are now required, templates moving from preact to `zibri-tsx`. Install the new versions, run `tsc`, and work through the errors.

A name `zibri` no longer exports is often on `zibri/internal`: what only building a data source, driver, parser or router of your own needs. Import it from there, knowing that any release can change it, see [releases](./releases.md#what-is-public).

This page covers what compiles and still breaks: things that fail on the first start, lock users out, lose data or quietly behave differently. Go through it before you deploy.

## Before the first start
**Back up your database.** The migration below changes tables that already hold data.

**Use node 24 or newer.**

**Install the packages you use.** `pg` used to come with Zibri, and every other package it needed was installed with it. Now each feature asks for its own, and the application names the missing one while it starts. The full list is in [getting started](./getting-started.md#optional-packages).

**Install typeorm yourself if your code imports it.** A Postgres data source talks to `pg` itself, and typeorm is not installed with Zibri. A query written by hand runs on Zibri's own builder, see [writing a query by hand](./data-source.md#writing-a-query-by-hand). A `Relation<T>` imported from typeorm in an entity is `type Relation<T> = T`, which you can declare yourself.

**Check your `regex` declarations.** A `regex` on a string property or parameter needs `re2`, and one with lookarounds or backreferences is refused while the application starts, see [models](./models.md).

**Keep bcrypt.** Every password hash written by 2.x is a bcrypt hash, and bcrypt is no longer one of the default hash strategies. The application refuses to start with `There are missing strategies: bcrypt` until you add it back:

```ts
// src/providers.ts
import { BcryptHashStrategy, defineProvider, ScryptHashStrategy, Sha256HashStrategy, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.HASH_STRATEGIES,
    useValue: [ScryptHashStrategy, Sha256HashStrategy, BcryptHashStrategy]
});
```

The migration below marks bcrypt `DEPRECATED` and scrypt as the default, so each password is replaced with a scrypt hash the next time its user logs in. `BcryptHashStrategy` is deprecated: keep it registered while stored hashes need it.

**Say whether a hashed property holds a password.** A string declared with `hash` declares `password` as well, or the application refuses to start: `password: true` for a password, and `password: false` for anything else, such as a token. `password: true` hashes the property without `hash`, see [encryption and hashing](./encryption-and-hashing.md#defining-encryptedhashed-properties).

**Say what a password has to be.** An application whose entities hold a password, such as `PasswordCredentials`, refuses to start without `ZIBRI_DI_TOKENS.PASSWORD_POLICY`, such as `{ minLength: 15, outdatedPasswords: 'requireChange' }`. Every password written is checked against it. `outdatedPasswords` says whether a user whose password 2.x took and the policy refuses logs in with it, or [chooses a new one](./auth.md#requiring-a-new-password) first, see [how long a password may be](./auth.md#how-long-a-password-may-be). With `PasswordAuthenticator`, declare `LoginTicket` in your data source.

**Bring your project to what 3.x generates with `zi upgrade`.** Templates are compiled by `zibri-tsx` now, and the build, the jest configuration and the compiler options come from the packages, see [upgrade a project](./getting-started.md#upgrading-a-project). A 2.x project has no `zibri-scaffold.json`, so `zi upgrade` asks what `zi new` would have, and writes each file that differs from what 3.x generates beside yours as `<file>.zibri-upgrade`. Take what you need from each and delete it. Every later upgrade merges.

**Choose how your schema is managed.** `schemaManagement` is required on every sql data source, see [data source](./data-source.md). 2.x synchronized the schema unless you turned it off.

**Say whether your connections use tls.** `ssl` on every postgres data source and `useTLS` on every valkey data source are required, see [data source](./data-source.md). The `PGSSLMODE` environment variable does not apply to the postgres connection: if yours took its tls from there, set `ssl` instead.

**Say what stands between your application and postgres.** `pooler` is required on every postgres data source: `'none'` when it connects to the server itself. Behind a pooler in transaction mode, such as PgBouncer or most managed poolers, declare it with where the server itself is, and give the application's role its settings, see [connecting through a pooler](./data-source.md#connecting-through-a-pooler). A data source whose connections do not have the statement timeout and search similarity it asks for refuses to start.

**Say whether a login asks for a [second factor](./glossary.md#second-factor).** `twoFactorAtLogin` is required in your app options: `'never'` keeps logins as they were, `'ifEnrolled'` asks a user who enrolled a second factor for it, see [two factor](./two-factor.md#asking-for-a-second-factor-at-login). With anything but `'never'`, declare `LoginTicket` in your data source.

**Say where the application runs.** `environment` is required in your app options: `'production'` wherever it serves users. In `'development'`, an application without an email transport logs its mails instead of sending them, see [saying where the application runs](./architecture.md#saying-where-the-application-runs). `SmtpEmailTransport` refuses an empty `host` and a `port` that is no port, so a deployment that read them from unset variables stops at startup.

**Say how long failures and finished jobs are kept.** `failedRetentionInMs` is required in your `EMAIL_CONFIG`, and your providers need `ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS` and `ZIBRI_DI_TOKENS.THREAD_JOB_RETENTION_IN_MS`, which the application refuses to start without: a number of milliseconds, or `'forever'`. A failed mail or event, and a thread job that is over, is deleted once it is older, see [email](./email.md#what-happens-to-the-row), [events](./events.md#when-an-event-cannot-be-handled) and [multithreading](./multithreading.md#what-happens-to-a-finished-job).

**Rewrite the routes in your version files.** Each route in `versions/*.json` names the shape of its versions: `"versions": "all"` becomes `"versions": { "shape": "All", "value": "all" }`, and `"versions": [...]` becomes `"versions": { "shape": "Matchers", "value": [...] }`, see [version files](./versioning.md#version-files). The application refuses to start while a file holds the 2.x form, and lists every such route.

**Record each release in development.** In production the application only reads `versions`, and refuses to start on a version the record does not hold as the latest. Start the application once in development after raising the version, commit `versions`, and build from it, see [versioning](./versioning.md).

**Open the OpenAPI explorer where it is meant to be open.** The explorer and the document follow `defaultAuth`, so an application that requires a login by default answers an anonymous caller with `401`. Provide `ZIBRI_DI_TOKENS.OPEN_API_AUTH` as `{ skip: true }` to keep them open to everyone, see [restricting the explorer](./open-api.md#restricting-the-explorer).

**Add the scripts of the OpenAPI explorer to your assets.** The explorer loads `swagger-ui-init.js` and `custom.js` from your `assets/public/open-api/`, beside `custom.css`. `zi upgrade` writes both, see [changing the look of the explorer](./open-api.md#changing-the-look-of-the-explorer).

**Say how long the audit trail is kept.** Declare `AuditEntry`, `AuditCheckpoint`, `ChainAnchor` and `SigningKey` in your data source's `entities`, and provide `ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS`, which the application refuses to start without: a number of milliseconds, or `'forever'`. An entry is deleted once it is older, see [audit trail](./audit.md).

**Attach the content of a file to a mail.** An `EmailAttachment` holds `base64Content` in place of `path`, such as `{ filename: 'invoice.pdf', base64Content: (await readFile(path)).toString('base64') }`, see [email](./email.md#attaching-files).

**Bound your thread jobs.** Provide the options you change through `MULTITHREADING_OPTIONS_INPUT`, which is merged over the defaults; `MULTITHREADING_OPTIONS` holds the result. The defaults gain `maxAttempts` and `workerResourceLimits`: how many times a job may be started before a takeover fails it instead, and the memory a worker thread may take, see [multithreading](./multithreading.md#configuration). A job that is over `maxAttempts` ends `FAILED` with a `ThreadJobAttemptsExhaustedError`, where 2.x took it over again without end.

**Worker files are JavaScript.** `enableTsWorkerFiles` defaults to `false`, so a job naming a `.ts` file is refused, and the application runs without `ts-node`. Its build uses `ts-node`, as a devDependency. An application that runs TypeScript worker files sets it to `true` in `MULTITHREADING_OPTIONS_INPUT` and installs `ts-node` and `typescript`, both of which are loaded at startup. A built application names the compiled file, see [shipping the worker file](./multithreading.md#shipping-the-worker-file).

## The migration
Every 2.x database needs the same changes to the entities Zibri ships. Copy these three migrations into your data source and list them first in its `migrations`, in this order. They work under every `schemaManagement`, and skip what your data source does not hold. Run them against a copy of your production database before you deploy.

```ts
// src/data-sources/db/migrations/upgrade-to-zibri-3.migration.ts
import { readFile } from 'node:fs/promises';

import { ArrayPropertyMetadataInput, AuditCheckpoint, AuditEntry, BackupEntity, BackupResourceEntity, BackupStatus, BaseEntity, CacheInvalidation, ChainAnchor, Change, ChangeSet, CookieAuthRefreshSession, CookieAuthSession, CronJobEntity, CronJobState, Email, EmailAttachment, EmailStatus, EncryptionRotationFailure, EncryptionRotationProgress, Event, EventSubscriberRegistration, EventSubscriberRun, EventSubscriberRunStatus, HashStrategyEntity, HashStrategyStatus, HttpStatus, Injectable, Invoice, InvoiceRecipientAbbreviation, JwtRefreshToken, Lease, Log, LOGIN_USER_AGENT_MAX_LENGTH, LoggedError, LogLevel, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken, MasterKeyReference, Migration, Newable, NumberInvoices, NumberPropertyMetadataInput, OtpCredentials, PasswordCredentials, PasswordResetToken, Payment, RateLimitStateEntity, Repository, RepositoryTypeForEntity, SemVerVersion, SigningKey, ThreadJobEntity, timezoneEnum, Transaction, TwoFactorFailureStreak, TwoFactorRecoveryCode, ValueConversion, WebsocketChannel, WebsocketMessage } from 'zibri';

import { DbDataSource } from '../db.data-source';

// the tenant everything your 2.x application stored belongs to: a uuid you pick once
const TENANT_ID: string = '3f0c1d52-8b6e-4c55-9a4f-2d1e7b9c4a10';

@Injectable()
export class UpgradeToZibri3Migration extends Migration {
    // the version of your application that ships the upgrade
    version: SemVerVersion = '1.0.0';

    constructor() {
        super(DbDataSource);
    }

    override async up(transaction: Transaction): Promise<void> {
        await this.createEntities(transaction);
        await this.movePasswords(transaction);
        await this.retireBcrypt(transaction);
        await this.retypeNumbers(transaction);
        await this.upgradeCronJobs(transaction);
        await this.upgradeEventSubscriberRuns(transaction);
        await this.upgradeBackups(transaction);
        await this.upgradeTheRest(transaction);
        await this.addTenantColumns(transaction);
        await this.inlineMailAttachments(transaction);
        await this.addPluginTenantColumns(transaction);
        await this.upgradeMailingListConfirmations(transaction);
    }

    override async down(): Promise<void> {
        throw new Error('To go back to 2.x, restore the backup you took before the upgrade.');
    }

    private holds(entity: Newable<BaseEntity>): boolean {
        return this.dataSource.entities.includes(entity);
    }

    private async createEntities(transaction: Transaction): Promise<void> {
        if (this.holds(CacheInvalidation)) {
            await this.dataSource.createEntity({
                entity: CacheInvalidation,
                properties: { tags: { type: 'array', items: { type: 'string' } }, at: { type: 'date' } },
                transaction
            });
        }
        if (this.holds(InvoiceRecipientAbbreviation)) {
            await this.dataSource.createEntity({
                entity: InvoiceRecipientAbbreviation,
                properties: {
                    tenantId: { type: 'string', format: 'uuid' },
                    recipientId: { type: 'string' },
                    nameAbbreviation: { type: 'string' }
                },
                transaction
            });
        }
        if (this.holds(EventSubscriberRegistration)) {
            await this.dataSource.createEntity({
                entity: EventSubscriberRegistration,
                properties: { subscriberId: { type: 'string' }, eventType: { type: 'string' }, expiresAt: { type: 'date' } },
                transaction
            });
        }
        if (this.holds(Lease)) {
            await this.dataSource.createEntity({
                entity: Lease,
                properties: { key: { type: 'string' }, expiresAt: { type: 'date' }, heldBy: { type: 'string' } },
                transaction
            });
        }
        if (this.holds(AuditEntry)) {
            await this.dataSource.createEntity({
                entity: AuditEntry,
                properties: {
                    tenantId: { type: 'string', format: 'uuid', required: false },
                    action: { type: 'string' },
                    outcome: { type: 'string' },
                    reason: { type: 'string', required: false },
                    subject: { type: 'string', required: false },
                    userId: { type: 'string', required: false },
                    scopes: { type: 'array', items: { type: 'string' }, required: false },
                    role: { type: 'string', required: false },
                    clientIp: { type: 'string', required: false },
                    traceId: { type: 'string', required: false },
                    occurredAt: { type: 'date' },
                    lastOccurredAt: { type: 'date' },
                    count: { type: 'number', format: 'integer' },
                    collapsed: { type: 'string', required: false },
                    recordedAt: { type: 'date' },
                    mac: { type: 'string' }
                },
                transaction
            });
        }
        if (this.holds(AuditCheckpoint)) {
            await this.dataSource.createEntity({
                entity: AuditCheckpoint,
                properties: {
                    tenantId: { type: 'string', format: 'uuid', required: false },
                    periodStart: { type: 'date' },
                    periodEnd: { type: 'date' },
                    entryCount: { type: 'number', format: 'integer' },
                    digest: { type: 'string' },
                    chainSequence: { type: 'number', format: 'integer' },
                    chainHash: { type: 'string' }
                },
                transaction
            });
        }
        if (this.holds(ChainAnchor)) {
            await this.dataSource.createEntity({
                entity: ChainAnchor,
                properties: {
                    tableName: { type: 'string' },
                    chain: { type: 'string' },
                    sequence: { type: 'number', format: 'integer' },
                    hash: { type: 'string' },
                    seal: { type: 'string' }
                },
                transaction
            });
        }
        if (this.holds(SigningKey)) {
            await this.dataSource.createEntity({
                entity: SigningKey,
                properties: { name: { type: 'string' }, value: { type: 'string' } },
                transaction
            });
        }
        if (this.holds(RateLimitStateEntity)) {
            await this.dataSource.createEntity({
                entity: RateLimitStateEntity,
                properties: {
                    key: { type: 'string' },
                    expiresAtMs: { type: 'number' },
                    nextReservationExpiresAtMs: { type: 'number', required: false },
                    version: { type: 'number', format: 'integer' },
                    state: { type: 'unknown' }
                },
                transaction
            });
        }
        if (this.holds(TwoFactorFailureStreak)) {
            await this.dataSource.createEntity({
                entity: TwoFactorFailureStreak,
                properties: {
                    userId: { type: 'string', format: 'uuid' },
                    count: { type: 'number', format: 'integer' },
                    retryAt: { type: 'date' },
                    lockedAt: { type: 'date', required: false }
                },
                transaction
            });
        }
        if (this.holds(EncryptionRotationProgress)) {
            await this.dataSource.createEntity({
                entity: EncryptionRotationProgress,
                properties: {
                    entityName: { type: 'string', required: false },
                    cursor: { type: 'string', required: false },
                    passRetiredKeyIds: { type: 'array', items: { type: 'string' } },
                    sweptRetiredKeyIds: { type: 'array', items: { type: 'string' } }
                },
                transaction
            });
        }
        if (this.holds(EncryptionRotationFailure)) {
            await this.dataSource.createEntity({
                entity: EncryptionRotationFailure,
                properties: {
                    entityName: { type: 'string' },
                    rowId: { type: 'string' },
                    keyIds: { type: 'array', items: { type: 'string' } },
                    error: { type: 'string' },
                    attempts: { type: 'number', format: 'integer' },
                    failedAt: { type: 'date' },
                    retryAt: { type: 'date' }
                },
                transaction
            });
        }
        if (this.holds(TwoFactorRecoveryCode)) {
            await this.dataSource.createEntity({
                entity: TwoFactorRecoveryCode,
                properties: {
                    userId: { type: 'string', format: 'uuid' },
                    code: { type: 'string' },
                    confirmed: { type: 'boolean', default: false }
                },
                transaction
            });
        }
    }

    private async movePasswords(transaction: Transaction): Promise<void> {
        if (!this.holds(PasswordCredentials)) {
            return;
        }
        // one line for each strategy your application logged in with. A user with a password in both
        // keeps the one of the line above
        await this.dataSource.mergeEntity({ entity: PasswordCredentials, currentTableName: 'jwt_credentials', transaction });
        await this.dataSource.mergeEntity({ entity: PasswordCredentials, currentTableName: 'cookie_auth_credentials', transaction });
        // the email is read from the user
        await this.dataSource.removePropertyFromEntity({ entity: PasswordCredentials, propertyKey: 'email', transaction });
        await this.dataSource.addPropertyToEntity({
            entity: PasswordCredentials,
            property: { name: 'changeRequired', type: 'boolean', default: false },
            transaction
        });
    }

    // 2.x recorded bcrypt as the default strategy, which every new hash would otherwise still use.
    // A deprecated strategy's hashes are replaced on their user's next login
    private async retireBcrypt(transaction: Transaction): Promise<void> {
        if (!this.holds(HashStrategyEntity)) {
            return;
        }
        const strategies: RepositoryTypeForEntity<HashStrategyEntity> = this.dataSource.getRepository(HashStrategyEntity);
        await strategies.updateAll({ name: 'bcrypt' }, { status: HashStrategyStatus.DEPRECATED }, { transaction });
        await strategies.create({ name: 'scrypt', version: 'v1', status: HashStrategyStatus.DEFAULT }, { transaction });
    }

    // a number without a format is stored as a double now, where 2.x stored an exact decimal - which is
    // what a bignumber is stored as
    private async retypeNumbers(transaction: Transaction): Promise<void> {
        const changes: [Newable<BaseEntity>, string, NumberPropertyMetadataInput & { type: 'number' }][] = [
            [BackupResourceEntity, 'size', { type: 'number', format: 'integer', required: false }],
            [Log, 'level', { type: 'number', format: 'integer', enum: LogLevel }],
            [NumberInvoices, 'number', { type: 'number', format: 'integer' }],
            [NumberInvoices, 'year', { type: 'number', format: 'integer' }],
            [ThreadJobEntity, 'progress', { type: 'number', format: 'integer' }],
            [ThreadJobEntity, 'queuedAtMs', { type: 'number', format: 'integer' }],
            [ThreadJobEntity, 'startedAtMs', { type: 'number', format: 'integer', required: false }],
            [ThreadJobEntity, 'stoppedAtMs', { type: 'number', format: 'integer', required: false }],
            [ThreadJobEntity, 'threadId', { type: 'number', format: 'integer', required: false }],
            [WebsocketMessage, 'seq', { type: 'number', format: 'integer' }],
            [WebsocketMessage, 'status', { type: 'number', format: 'integer', enum: HttpStatus }]
        ];
        for (const [entity, name, metadata] of changes.filter(([entity]) => this.holds(entity))) {
            await this.dataSource.changePropertyOfEntity({
                entity,
                currentProperty: { name, type: 'number', format: 'bignumber' },
                property: { ...metadata, name },
                transaction
            });
        }
    }

    private async upgradeCronJobs(transaction: Transaction): Promise<void> {
        if (!this.holds(CronJobEntity)) {
            return;
        }
        await this.dataSource.changePropertyOfEntity({
            entity: CronJobEntity,
            currentProperty: { name: 'active', type: 'boolean' },
            property: { name: 'state', type: 'string', enum: CronJobState },
            convert: {
                values: [{ from: true, to: CronJobState.ACTIVE }, { from: false, to: CronJobState.INACTIVE }],
                default: ValueConversion.NONE
            },
            transaction
        });
        // every start sets a job's time zone from its class, so 'UTC' only fills the rows until then
        await this.dataSource.addPropertyToEntity({
            entity: CronJobEntity,
            property: { name: 'timezone', type: 'string', enum: timezoneEnum, default: 'UTC' },
            transaction
        });
        await this.dataSource.changePropertyOfEntity({
            entity: CronJobEntity,
            currentProperty: { name: 'timezone', type: 'string', enum: timezoneEnum, default: 'UTC' },
            property: { name: 'timezone', type: 'string', enum: timezoneEnum },
            transaction
        });
        await this.dataSource.addPropertyToEntity({
            entity: CronJobEntity,
            property: { name: 'previousState', type: 'string', enum: CronJobState, required: false },
            transaction
        });
        await this.dataSource.addPropertyToEntity({
            entity: CronJobEntity,
            property: { name: 'catchUpWithinInMs', type: 'number', required: false },
            transaction
        });
        // every job 2.x stored is a class of the application
        await this.dataSource.addPropertyToEntity({
            entity: CronJobEntity,
            property: { name: 'source', type: 'string', default: 'code' },
            transaction
        });
        await this.dataSource.changePropertyOfEntity({
            entity: CronJobEntity,
            currentProperty: { name: 'source', type: 'string', default: 'code' },
            property: { name: 'source', type: 'string' },
            transaction
        });
        // what a job does on a failure is read from its class, as onFailure
        await this.dataSource.removePropertyFromEntity({ entity: CronJobEntity, propertyKey: 'stopOnError', transaction });
        await this.dataSource.addPropertyToEntity({
            entity: CronJobEntity,
            property: { name: 'consecutiveFailures', type: 'number', format: 'integer', default: 0 },
            transaction
        });
        await this.dataSource.changePropertyOfEntity({
            entity: CronJobEntity,
            currentProperty: { name: 'consecutiveFailures', type: 'number', format: 'integer', default: 0 },
            property: { name: 'consecutiveFailures', type: 'number', format: 'integer' },
            transaction
        });
        await this.dataSource.addPropertyToEntity({
            entity: CronJobEntity,
            property: { name: 'backedOffUntil', type: 'date', required: false },
            transaction
        });
        // empty until the first start, which records what each class declares
        await this.dataSource.addPropertyToEntity({
            entity: CronJobEntity,
            property: { name: 'declaredCron', type: 'string', required: false },
            transaction
        });
        await this.dataSource.addPropertyToEntity({
            entity: CronJobEntity,
            property: { name: 'declaredActive', type: 'boolean', required: false },
            transaction
        });
        // the jobs that deleted expired sessions, refresh tokens and logs, which ExpiredRowsCleanupCronJob does
        await this.dataSource.getRepository(CronJobEntity).deleteAll(
            { name: { oneOf: ['Cleanup cookie auth sessions', 'Cleanup jwt refresh tokens', 'Log Cleanup'] } },
            { transaction }
        );
    }

    private async upgradeEventSubscriberRuns(transaction: Transaction): Promise<void> {
        if (!this.holds(EventSubscriberRun)) {
            return;
        }
        // 2.x stored a run's error as an empty object, so all it says is whether the run failed
        await this.dataSource.changePropertyOfEntity({
            entity: EventSubscriberRun,
            currentProperty: { name: 'error', type: 'unknown', required: false },
            property: { name: 'status', type: 'string', enum: EventSubscriberRunStatus },
            convert: {
                values: [{ from: null, to: EventSubscriberRunStatus.SUCCEEDED }, { from: {}, to: EventSubscriberRunStatus.FAILED }],
                default: ValueConversion.NONE
            },
            transaction
        });
        await this.dataSource.addPropertyToEntity({
            entity: EventSubscriberRun,
            property: { name: 'error', type: 'object', cls: () => LoggedError, required: false },
            transaction
        });
        await this.dataSource.addPropertyToEntity({
            entity: EventSubscriberRun,
            property: { name: 'attempts', type: 'number', format: 'integer', default: 1 },
            transaction
        });
        await this.dataSource.changePropertyOfEntity({
            entity: EventSubscriberRun,
            currentProperty: { name: 'attempts', type: 'number', format: 'integer', default: 1 },
            property: { name: 'attempts', type: 'number', format: 'integer' },
            transaction
        });
        await this.dataSource.addPropertyToEntity({
            entity: EventSubscriberRun,
            property: { name: 'finishedAt', type: 'date', default: new Date() },
            transaction
        });
        await this.dataSource.changePropertyOfEntity({
            entity: EventSubscriberRun,
            currentProperty: { name: 'finishedAt', type: 'date', default: new Date() },
            property: { name: 'finishedAt', type: 'date' },
            transaction
        });
        await this.dataSource.addPropertyToEntity({
            entity: EventSubscriberRun,
            property: { name: 'nextAttemptAt', type: 'date', required: false },
            transaction
        });
    }

    private async upgradeBackups(transaction: Transaction): Promise<void> {
        if (this.holds(BackupEntity)) {
            // 2.x wrote backups in no format 3.0.0 reads, so a restore refuses them by name instead of misreading them
            await this.dataSource.addPropertyToEntity({
                entity: BackupEntity,
                property: { name: 'formatVersion', type: 'number', format: 'integer', default: 0 },
                transaction
            });
            await this.dataSource.changePropertyOfEntity({
                entity: BackupEntity,
                currentProperty: { name: 'formatVersion', type: 'number', format: 'integer', default: 0 },
                property: { name: 'formatVersion', type: 'number', format: 'integer' },
                transaction
            });
            await this.dataSource.addPropertyToEntity({
                entity: BackupEntity,
                property: { name: 'zibriVersion', type: 'string', default: '2.x' },
                transaction
            });
            await this.dataSource.changePropertyOfEntity({
                entity: BackupEntity,
                currentProperty: { name: 'zibriVersion', type: 'string', default: '2.x' },
                property: { name: 'zibriVersion', type: 'string' },
                transaction
            });
            await this.addBackupKeyColumns(transaction);
            // every backup 2.x recorded was taken to its end
            await this.dataSource.addPropertyToEntity({
                entity: BackupEntity,
                property: { name: 'status', type: 'string', enum: BackupStatus, default: BackupStatus.COMPLETED },
                transaction
            });
        }
        if (this.holds(BackupResourceEntity)) {
            await this.dataSource.addPropertyToEntity({
                entity: BackupResourceEntity,
                property: { name: 'checksum', type: 'string', required: false },
                transaction
            });
            await this.dataSource.addPropertyToEntity({
                entity: BackupResourceEntity,
                property: { name: 'encryptedKey', type: 'string', required: false },
                transaction
            });
            await this.dataSource.addPropertyToEntity({
                entity: BackupResourceEntity,
                property: { name: 'attempts', type: 'number', format: 'integer', default: 0 },
                transaction
            });
            await this.dataSource.addPropertyToEntity({
                entity: BackupResourceEntity,
                property: { name: 'nextAttemptAt', type: 'date', required: false },
                transaction
            });
            await this.dataSource.addPropertyToEntity({
                entity: BackupResourceEntity,
                property: { name: 'error', type: 'object', cls: () => LoggedError, required: false },
                transaction
            });
        }
    }

    private async upgradeTheRest(transaction: Transaction): Promise<void> {
        if (this.holds(Email)) {
            await this.dataSource.addPropertyToEntity({
                entity: Email,
                property: { name: 'rejectedRecipients', type: 'array', items: { type: 'string', format: 'email' }, required: false },
                transaction
            });
            await this.dataSource.addPropertyToEntity({
                entity: Email,
                property: { name: 'listUnsubscribeUrl', type: 'string', required: false },
                transaction
            });
            // how many times sending a mail threw, which no mail 2.x queued has done yet
            await this.dataSource.addPropertyToEntity({
                entity: Email,
                property: { name: 'attempts', type: 'number', format: 'integer', default: 0 },
                transaction
            });
            await this.dataSource.changePropertyOfEntity({
                entity: Email,
                currentProperty: { name: 'attempts', type: 'number', format: 'integer', default: 0 },
                property: { name: 'attempts', type: 'number', format: 'integer' },
                transaction
            });
            await this.dataSource.addPropertyToEntity({
                entity: Email,
                property: { name: 'nextAttemptAt', type: 'date', required: false },
                transaction
            });
            await this.dataSource.addPropertyToEntity({
                entity: Email,
                property: { name: 'error', type: 'object', cls: () => LoggedError, required: false },
                transaction
            });
        }
        // the trace a job was queued in, which no job 2.x queued was
        if (this.holds(ThreadJobEntity)) {
            for (const name of ['traceparent', 'tracestate']) {
                await this.dataSource.addPropertyToEntity({ entity: ThreadJobEntity, property: { name, type: 'string', required: false }, transaction });
            }
            // how many times a job was started, which 2.x did not count: a job that is over was started
            // at least once, and one that was not is owed its first start
            await this.dataSource.addPropertyToEntity({
                entity: ThreadJobEntity,
                property: { name: 'attempts', type: 'number', format: 'integer', default: 0 },
                transaction
            });
            await this.dataSource.changePropertyOfEntity({
                entity: ThreadJobEntity,
                currentProperty: { name: 'attempts', type: 'number', format: 'integer', default: 0 },
                property: { name: 'attempts', type: 'number', format: 'integer' },
                transaction
            });
            // a column every queue of work shares, which a thread job leaves empty
            await this.dataSource.addPropertyToEntity({
                entity: ThreadJobEntity,
                property: { name: 'nextAttemptAt', type: 'date', required: false },
                transaction
            });
            // the instance running a job, beside the thread running it
            await this.dataSource.addPropertyToEntity({
                entity: ThreadJobEntity,
                property: { name: 'instanceId', type: 'string', required: false },
                transaction
            });
            // the last checkpoint a job stored, which no job 2.x ran did
            await this.dataSource.addPropertyToEntity({
                entity: ThreadJobEntity,
                property: { name: 'checkpoint', type: 'unknown', required: false },
                transaction
            });
            // the timeout of a job, named with its unit, and stored as a double where 2.x stored an exact decimal
            await this.dataSource.changePropertyOfEntity({
                entity: ThreadJobEntity,
                currentProperty: { name: 'timeout', type: 'number', format: 'bignumber' },
                property: { name: 'timeoutInMs', type: 'number' },
                transaction
            });
        }
        // when an event is next dispatched, which for everything 2.x left pending is now
        if (this.holds(Event)) {
            await this.dataSource.addPropertyToEntity({
                entity: Event,
                property: { name: 'nextDispatchAt', type: 'date', default: new Date() },
                transaction
            });
            await this.dataSource.changePropertyOfEntity({
                entity: Event,
                currentProperty: { name: 'nextDispatchAt', type: 'date', default: new Date() },
                property: { name: 'nextDispatchAt', type: 'date' },
                transaction
            });
        }
        if (this.holds(OtpCredentials)) {
            await this.dataSource.removePropertyFromEntity({ entity: OtpCredentials, propertyKey: 'qrCodeUrl', transaction });
        }
        // the cookies 2.x set carry the id of a row, and a session is found by its hashed token now, so
        // what 2.x stored matches nothing
        if (this.holds(CookieAuthSession)) {
            await this.dataSource.getRepository(CookieAuthSession).deleteAll({}, { transaction });
            await this.dataSource.addPropertyToEntity({ entity: CookieAuthSession, property: { name: 'token', type: 'string' }, transaction });
        }
        if (this.holds(CookieAuthRefreshSession)) {
            await this.dataSource.getRepository(CookieAuthRefreshSession).deleteAll({}, { transaction });
            await this.dataSource.addPropertyToEntity({ entity: CookieAuthRefreshSession, property: { name: 'token', type: 'string' }, transaction });
            await this.dataSource.removePropertyFromEntity({ entity: CookieAuthRefreshSession, propertyKey: 'csrfToken', transaction });
            await this.dataSource.addPropertyToEntity({
                entity: CookieAuthRefreshSession,
                property: { name: 'authenticatedAt', type: 'date' },
                transaction
            });
            await this.addFederatedColumns(CookieAuthRefreshSession, transaction);
            await this.addLoginDeviceColumns(CookieAuthRefreshSession, transaction);
        }
        // both are stored hashed now, so what 2.x stored matches nothing
        if (this.holds(JwtRefreshToken)) {
            await this.dataSource.getRepository(JwtRefreshToken).deleteAll({}, { transaction });
            await this.addFederatedColumns(JwtRefreshToken, transaction);
            await this.dataSource.addPropertyToEntity({
                entity: JwtRefreshToken,
                property: { name: 'dpopKeyThumbprint', type: 'string', required: false },
                transaction
            });
            await this.dataSource.addPropertyToEntity({
                entity: JwtRefreshToken,
                property: { name: 'authenticatedAt', type: 'date', required: false },
                transaction
            });
            await this.addLoginDeviceColumns(JwtRefreshToken, transaction);
        }
        if (this.holds(PasswordResetToken)) {
            await this.dataSource.getRepository(PasswordResetToken).deleteAll({}, { transaction });
        }
    }

    // when a login was last used, and from which client, which a user's list of their logins shows
    private async addLoginDeviceColumns(entity: Newable<BaseEntity>, transaction: Transaction): Promise<void> {
        await this.dataSource.addPropertyToEntity({ entity, property: { name: 'issuedAt', type: 'date', required: false }, transaction });
        await this.dataSource.addPropertyToEntity({
            entity,
            property: { name: 'userAgent', type: 'string', maxLength: LOGIN_USER_AGENT_MAX_LENGTH, required: false },
            transaction
        });
        await this.dataSource.addPropertyToEntity({ entity, property: { name: 'ipAddress', type: 'string', required: false }, transaction });
    }

    // the keys a restore needs, which a 2.x backup needs none of: a restore refuses it by its format
    private async addBackupKeyColumns(transaction: Transaction): Promise<void> {
        const masterKeys: ArrayPropertyMetadataInput = { items: { type: 'object', cls: () => MasterKeyReference } };
        const dataKeyIds: ArrayPropertyMetadataInput = { items: { type: 'string' } };
        await this.dataSource.addPropertyToEntity({
            entity: BackupEntity,
            property: { name: 'masterKeys', type: 'array', ...masterKeys, required: false },
            transaction
        });
        await this.dataSource.addPropertyToEntity({
            entity: BackupEntity,
            property: { name: 'dataKeyIds', type: 'array', ...dataKeyIds, required: false },
            transaction
        });
        await this.dataSource.getRepository(BackupEntity).updateAll({}, { masterKeys: [], dataKeyIds: [] }, { transaction });
        await this.dataSource.changePropertyOfEntity({
            entity: BackupEntity,
            currentProperty: { name: 'masterKeys', type: 'array', ...masterKeys, required: false },
            property: { name: 'masterKeys', type: 'array', ...masterKeys },
            transaction
        });
        await this.dataSource.changePropertyOfEntity({
            entity: BackupEntity,
            currentProperty: { name: 'dataKeyIds', type: 'array', ...dataKeyIds, required: false },
            property: { name: 'dataKeyIds', type: 'array', ...dataKeyIds },
            transaction
        });
    }

    // the tenant work was started in. Everything 2.x stored belongs to no tenant, which every tenant sees
    private async addTenantColumns(transaction: Transaction): Promise<void> {
        const entities: Newable<BaseEntity>[] = [
            Change, ChangeSet, Email, Event, EventSubscriberRun, Log, ThreadJobEntity, WebsocketChannel, WebsocketMessage
        ];
        for (const entity of entities.filter(entity => this.holds(entity))) {
            await this.dataSource.addPropertyToEntity({
                entity,
                property: { name: 'tenantId', type: 'string', format: 'uuid', required: false },
                transaction
            });
        }
    }

    // a queued mail carries the content of its attachments, where 2.x named a file on this disk
    private async inlineMailAttachments(transaction: Transaction): Promise<void> {
        if (!this.holds(Email)) {
            return;
        }
        const emails: Repository<Email> = this.dataSource.getRepository(Email);
        const queued: Email[] = await emails.findAll({ where: { status: EmailStatus.QUEUED }, limit: 'all', acrossTenants: true, transaction });
        for (const email of queued) {
            if (!email.attachments?.length) {
                continue;
            }
            try {
                const attachments: EmailAttachment[] = await Promise.all(email.attachments.map(async a => ({
                    filename: a.filename,
                    base64Content: (await readFile(String(Reflect.get(a, 'path')))).toString('base64')
                })));
                await emails.updateById(email.id, { attachments }, { acrossTenants: true, transaction });
            }
            catch {
                // a file that is gone fails the mail, as 2.x would have once it tried to send it
                await emails.updateById(email.id, { status: EmailStatus.FAILED }, { acrossTenants: true, transaction });
            }
        }
    }

    // the rows of the plugins belong to a tenant, and everything 2.x stored to the one it had
    private async addPluginTenantColumns(transaction: Transaction): Promise<void> {
        const entities: Newable<BaseEntity>[] = [
            Invoice, NumberInvoices, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken, Payment
        ];
        for (const entity of entities.filter(entity => this.holds(entity))) {
            await this.dataSource.addPropertyToEntity({
                entity,
                property: { name: 'tenantId', type: 'string', format: 'uuid', default: TENANT_ID },
                transaction
            });
            await this.dataSource.changePropertyOfEntity({
                entity,
                currentProperty: { name: 'tenantId', type: 'string', format: 'uuid', default: TENANT_ID },
                property: { name: 'tenantId', type: 'string', format: 'uuid' },
                transaction
            });
        }
    }

    // stored hashed now, so what 2.x stored matches nothing
    private async upgradeMailingListConfirmations(transaction: Transaction): Promise<void> {
        if (!this.holds(MailingListSubscriptionConfirmationToken)) {
            return;
        }
        await this.dataSource.getRepository(MailingListSubscriptionConfirmationToken).deleteAll({}, { transaction, acrossTenants: true });
        await this.dataSource.addPropertyToEntity({
            entity: MailingListSubscriptionConfirmationToken,
            property: { name: 'spent', type: 'boolean' },
            transaction
        });
    }

    // the provider a login was started at, which every login 2.x started has none of
    private async addFederatedColumns(entity: Newable<BaseEntity>, transaction: Transaction): Promise<void> {
        for (const name of ['federatedProvider', 'federatedSubjectKey', 'federatedSessionKey', 'federatedLogout']) {
            await this.dataSource.addPropertyToEntity({ entity, property: { name, type: 'string', required: false }, transaction });
        }
    }
}
```

```ts
// src/data-sources/db/migrations/encrypt-otp-secrets.migration.ts
import { Injectable, Migration, OtpCredentials, Repository, SemVerVersion, Transaction } from 'zibri';

import { DbDataSource } from '../db.data-source';

@Injectable()
export class EncryptOtpSecretsMigration extends Migration {
    version: SemVerVersion = '1.0.0';

    constructor() {
        super(DbDataSource);
    }

    override async up(transaction: Transaction): Promise<void> {
        if (!this.dataSource.entities.includes(OtpCredentials)) {
            return;
        }
        const credentials: Repository<OtpCredentials> = this.dataSource.getRepository(OtpCredentials);
        const stored: OtpCredentials[] = await credentials.findAll({ limit: 'all', autoDecrypt: false, transaction });
        // an encrypted value always contains a ".", a secret stored by 2.x never does
        const unencrypted: OtpCredentials[] = stored.filter(c => !c.secret.includes('.'));
        await Promise.all(unencrypted.map(c => credentials.updateById(c.id, { secret: c.secret }, { transaction })));
    }

    override async down(): Promise<void> {
        throw new Error('To go back to 2.x, restore the backup you took before the upgrade.');
    }
}
```

```ts
// src/data-sources/db/migrations/add-mailing-list-secrets.migration.ts
import { randomBytes } from 'node:crypto';

import { Injectable, MailingListSubscriber, Migration, Repository, SemVerVersion, Transaction } from 'zibri';

import { DbDataSource } from '../db.data-source';

@Injectable()
export class AddMailingListSecretsMigration extends Migration {
    version: SemVerVersion = '1.0.0';

    constructor() {
        super(DbDataSource);
    }

    override async up(transaction: Transaction): Promise<void> {
        if (!this.dataSource.entities.includes(MailingListSubscriber)) {
            return;
        }
        await this.dataSource.addPropertyToEntity({
            entity: MailingListSubscriber,
            property: { name: 'secret', type: 'string', required: false },
            transaction
        });
        const subscribers: Repository<MailingListSubscriber> = this.dataSource.getRepository(MailingListSubscriber);
        const stored: MailingListSubscriber[] = await subscribers.findAll({ limit: 'all', acrossTenants: true, autoDecrypt: false, transaction });
        await Promise.all(stored.map(s => subscribers.updateById(
            s.id,
            { secret: randomBytes(32).toString('hex') },
            { acrossTenants: true, transaction }
        )));
        await this.dataSource.changePropertyOfEntity({
            entity: MailingListSubscriber,
            currentProperty: { name: 'secret', type: 'string', required: false },
            property: { name: 'secret', type: 'string' },
            transaction
        });
    }

    override async down(): Promise<void> {
        throw new Error('To go back to 2.x, restore the backup you took before the upgrade.');
    }
}
```

What they change:

| Change | Why it matters |
|---|---|
| New entities are created | [Leases](./glossary.md#lease), cache invalidations, event subscriber registrations, rate limit state, two factor failure streaks, recovery codes, the name abbreviations of invoice recipients, and the progress and failures of the [key rotation](./encryption-and-hashing.md#rotating-a-key) each have a table of their own |
| The passwords move from `jwt_credentials` and `cookie_auth_credentials` to `PasswordCredentials`, without the email | Every login reads them from there |
| `PasswordCredentials` gets `changeRequired`, `false` for every password 2.x stored | Whether the user [chooses a new password](./auth.md#requiring-a-new-password) before their next login |
| bcrypt is marked `DEPRECATED` in the hash strategy table, and scrypt the default | New passwords are hashed with scrypt, and each bcrypt hash is replaced with one the next time its user logs in |
| Number columns without a format become doubles | 2.x stored them as decimals |
| A cron job's `active` becomes `state`, and `timezone` is added | Both are required |
| A cron job gets `source`, `'code'` for every job 2.x stored | `cronService.update()` refuses a job declared in code; `enable`, `disable` and `changeCron` change it on every instance, see [changing a job while the app runs](./cron.md#changing-a-job-while-the-app-runs) |
| The cron jobs `Cleanup cookie auth sessions`, `Cleanup jwt refresh tokens` and `Log Cleanup` are deleted | `ExpiredRowsCleanupCronJob` deletes the expired rows of every entity that declares `expiresBy`, see [deleting rows once they expire](./data-source.md#deleting-rows-once-they-expire) |
| A cron job loses `stopOnError`, and gets `consecutiveFailures` and `backedOffUntil` | A job declares what it does on a failure as `onFailure` in its class, `stopOnError: true` as `onFailure: { stopAfterFailures: 1 }`. The failures are counted on the row, see [when a tick throws](./cron.md#when-a-tick-throws) |
| An event subscriber run gets `status`, `attempts`, `finishedAt` and `nextAttemptAt` | Both are required. A run 2.x recorded with an error counts as failed, and every run counts as finished at the upgrade. `nextAttemptAt` is when a run waiting for a retry is due |
| Backups 2.x took are marked as format `0`, and record no keys in `masterKeys` and `dataKeyIds` | A restore refuses them by name instead of misreading them, so they need no key |
| Backups get `status`, `COMPLETED` for every one 2.x took, and backup resources `attempts`, `nextAttemptAt` and `error` | A backup is stored one resource at a time and tried again when a transport fails, see [creating and restoring backups](./backup.md#creating-and-restoring-backups) |
| Cookie sessions and cookie refresh sessions are deleted, and get `token` | The cookies carry a token, stored hashed. Every user of `CookieAuthStrategy` logs in again, see [every user logs in once](#every-user-logs-in-once) |
| A cookie refresh session loses `csrfToken`, and gets `authenticatedAt` | The csrf token is derived from the session's token. `authenticatedAt` is when its user logged in, which a route accepting a [recent login](./two-factor.md#accepting-a-recent-login-instead) reads |
| Refresh tokens and cookie refresh sessions get `federatedProvider`, `federatedSubjectKey`, `federatedSessionKey` and `federatedLogout` | The provider a login was started at, which a logout there finds the login by, see [logging out](./login-through-a-provider.md#logging-out) |
| Refresh tokens and password reset tokens are deleted | They are stored hashed now. Every user logs in again, see [every user logs in once](#every-user-logs-in-once), and reset links sent before the upgrade stop working |
| A refresh token gets `dpopKeyThumbprint` | The [DPoP](./glossary.md#dpop) key its login is bound to, see [binding tokens to a key](./dpop.md) |
| Refresh tokens and cookie refresh sessions get `issuedAt`, `userAgent` and `ipAddress`, and refresh tokens `authenticatedAt` | When a login was last used, from which client, and when its user logged in, which a user's [list of their logins](./auth.md#where-a-user-is-logged-in) shows |
| One time password secrets are encrypted | They are stored encrypted now, and reading one stored as it is fails. Users with two factor authentication cannot log in before this has run |
| Events, event subscriber runs, thread jobs, emails, logs, [change sets](./glossary.md#change-set), changes, websocket channels and websocket messages get `tenantId` | The [tenant](./tenancy.md#work-outside-a-request) each was started in. What 2.x stored belongs to no tenant, so every tenant sees it |
| Invoices, invoice counters, mailing lists, their subscribers and confirmation tokens, and payments get `tenantId` | Each belongs to a [tenant](./tenancy.md). What 2.x stored belongs to the tenant `TENANT_ID` names |
| Mailing list confirmation tokens are deleted, and get `spent` | They are stored hashed now, and confirm once. Confirmation links sent before the upgrade stop working |
| Emails get `listUnsubscribeUrl` | The [one-click unsubscribe](./email.md#sending-through-something-other-than-smtp) of a mail sent to a mailing list |
| Thread jobs get `traceparent` and `tracestate` | The [trace](./tracing.md#what-the-framework-records) a job was queued in, which its run is recorded under |
| Emails get `attempts`, `nextAttemptAt` and `error` | How many times sending a mail threw, when it is [tried again](./email.md#what-happens-to-the-row), and what the last send threw. A mail is `FAILED` after `maxSendAttempts` such attempts |
| A queued email's attachments get the content of their files | Any instance [sends the mail](./email.md#attaching-files). A mail whose file cannot be read is `FAILED` |
| Thread jobs get `attempts` and `nextAttemptAt` | How many times a job was started, which [bounds its takeovers](./multithreading.md#configuration). `nextAttemptAt` stays empty, since a job that failed is not tried again |
| Thread jobs get `checkpoint` | The last [checkpoint](./multithreading.md#resuming-from-a-checkpoint) a job stored, which a job taken over resumes from |
| Events get `nextDispatchAt` | When an event is dispatched next. Everything 2.x left pending is dispatched right away |
| Each mailing list subscriber gets a `secret` of their own, stored encrypted | The links to unsubscribe and to manage preferences carry it. Links in mails sent before the upgrade answer `400` |

`EncryptOtpSecretsMigration` and `AddMailingListSecretsMigration` are migrations of their own so that they run after the schema changes are committed.

Once they have run, the first start [keeps the indexes and uniques](./data-source.md#keeping-indexes-and-uniques) the entities declare: the uniques 2.x created are replaced by ones named the way an upsert refers to them, and the ones new in 3.x are added.

**When it fails.** A new unique fails the first start when the rows already stored break it, and the error names the values they share. Remove the duplicates in a migration listed after these two. **Never delete an encryption key**, because what was encrypted with it cannot be read without it. For a strategy with more than one `DEFAULT` key, set all but one of them to `'ACTIVE'`. For a duplicated strategy, point the keys of one at the other before deleting it. An event subscriber run whose error is not an empty object fails the conversion with that error, and you list it in `values`. A number that a double cannot hold exactly, like `0.1234567890123456789`, fails the conversion with that number. Give that property `format: 'bignumber'` instead and leave it out of `retypeNumbers`.

## Your own entities
**Tenants.** Every entity holds the tenant of its rows in the uuid `tenantId`, unless it names another property or is shared, see [tenants](./tenancy.md); the compiler names each one that has no such property, and a tenant property that is not `@Property.string({ format: 'uuid' })` refuses the start. Declare `tenant: 'shared'` on what every tenant shares, such as your users. For an entity whose rows belong to a tenant, add its tenant property in a migration, for example with `addPropertyToEntity`, `required: false` first, fill it in on the rows already stored, and then make it required. An application with one tenant gives every row that tenant's id, a uuid it picks once. On the first start, every unique and index of such an entity is replaced by one that starts with the tenant, and a relation between such an entity and a shared one refuses the start: keep the id of the shared row in a column instead.

**Memberships.** A request acts in the tenant its `x-tenant-id` header names; override `resolveTenant` in a `TenantService` of your own to read it from somewhere else, see [the tenant of a request](./tenancy.md#the-tenant-of-a-request). A logged in user acts in a tenant through their [membership](./glossary.md#membership) in it, so an application with users declares a membership entity, such as one extending `BaseMembershipEntity()`, and its repository, see **Repositories** below; it does not start otherwise. `@Auth.hasPermission` checks the roles of that membership, see **Roles** below: give each user a membership with the roles they need there, in a migration. `createApiKey` takes `tenantId`: `undefined` keeps a key acting wherever its user is a member. Your membership repository implements `resolveMembership`, `updateDeactivatedAt` and `deleteMembership` too, and a `TenantService` of your own `resolveTenantUrl`, which puts the tenant into a link the way `resolveTenant` reads it, see [the tenant of a request](./tenancy.md#the-tenant-of-a-request).

**Plugins.** Invoices, payments and mailing lists belong to a tenant. The invoicing plugin needs `InvoiceRecipientAbbreviation` in your data source's `entities`: each recipient's invoice numbers carry an abbreviation only they hold, see [the invoicing plugin](./invoicing-plugin.md#numbering-invoices). Invoice amounts are rounded to the minor units of their currency, and the tax of each tax group is taxed once rather than summed from its items, so a total can differ from what 2.x calculated by a cent. An invoice totalling less than 0 is refused. An XRechnung names its guideline `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0`, the identifier of XRechnung 3.0. A Peppol invoice requires the `electronicAddress` of the company and of the customer, see [the invoicing plugin](./invoicing-plugin.md#sending-electronic-invoices). An `EN16931ConformanceService` of your own checks an invoice in `validateInvoice` and names a party in `resolveElectronicAddress`. The item methods of `InvoiceCalcServiceInterface` take the invoice's currency after the item, and one of your own implements `getTaxGroups`; a `LocalizeServiceInterface` of your own implements `getCurrencyMinorUnits`. The `amount` of a payment and of `PayPalPaymentData` is a `BigNumber`, such as `new BigNumber('9.99')`, with at most the decimals of its currency, see [the payment plugin](./payment-plugin.md#stating-an-amount). A payment provider of your own implements `approvalWindowInMs` and `reconcilePayment`, see [the payment plugin](./payment-plugin.md#settling-abandoned-payments). The invoicing plugin reads the company of each tenant from a service under `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.COMPANY_INFO_SERVICE`, see [the invoicing plugin](./invoicing-plugin.md#setting-it-up): move `companyInfo`, `logo`, `bankName` and `taxOffice` out of `OPTIONS_INPUT` into it, and give each company the `timezone` it keeps its books in, whose calendar year numbers its invoices. The links of the mailing list plugin are resolved with `resolveSubscribeConfirmationLink`, `resolveUnsubscribeLink` and `resolveManagePreferencesLink`, which name the tenant, and the base email template gets `unsubscribeLink` and `managePreferencesLink` instead of building them. `confirmSubscription` takes the id of the list the link names ahead of the token, and an address already on other lists confirms a new one like any other address. `resolveUnsubscribeLink` and `resolveManagePreferencesLink` take the subscriber instead of their id, and a `MailingListServiceInterface` of your own implements `resolveSubscriberOfLink`. Opening an unsubscribe link no longer unsubscribes: the `UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE` gets `unsubscribed` and `unsubscribeUrl`, and renders a form posting to it while `unsubscribed` is false, see [the mailing list plugin](./mailing-list-plugin.md#unsubscribing). A link in an email sent before the upgrade names no tenant and answers `400`; an application with one tenant can read that tenant for such a request in its own `resolveTenant`.

**SCIM.** Each tenant's identity provider provisions that tenant, see [provisioning through SCIM](./scim.md): give it an api key bound to the tenant and listing the controller's `permission`, of a member holding a role there that carries it. The `permission` replaces the controller's `roles`: declare a permission for provisioning, such as `scim.provision`, and let the role you named carry it. A provisioner implements `findProvisionedUser` and `createProvisionedUser` in place of `resolveProvisionedUser`, and `resolveGroupMembership` gets the membership in the tenant instead of the user.

**Work outside a request.** An event, a queued thread job or email, a log entry, a change set and a websocket channel or message belong to the tenant they were started in, see [work outside a request](./tenancy.md#work-outside-a-request). A cron job runs outside every tenant, so one that reads a tenant's rows uses `runAs` or `acrossTenants`. `sendToAll` inside a tenant reaches the connections of its members only, and a websocket channel's name is unique within its tenant. A cache key holds the active tenant, so a cache filled outside a tenant is empty inside one. A `Transaction` of your own implements `afterCommit`, and a `MembershipServiceInterface` of your own `findMembershipEntityClass`. An `EventServiceInterface` of your own implements `dispatchPending`, `refreshSubscriberRegistrations` and `replayFailed`, and hands a hook its run as the third argument, see [events](./events.md), and an `EmailServiceInterface` of your own `deleteExpiredFailedEmails`. A `LeaseServiceInterface` of your own hands the work of `withLease`, `withLeases` and `hold` an `AbortSignal` that aborts with a `LeaseLostError` once the grant is lost, and puts one on what `keepAlive` returns; the `renew` of a `HeldLease` of your own throws a `LeaseLostError` when the grant is no longer this holder's, see [leases](./leases.md#renewing).

**Numbers.** A `@Property.number()` without a `format` is stored as a double, not as a decimal. For each of yours, either give it `format: 'bignumber'`, which keeps it an exact decimal and makes the property a `BigNumber`, or convert it in a migration the way `retypeNumbers` above does, such as `changePropertyOfEntity({ entity: Order, currentProperty: { name: 'total', type: 'number', format: 'bignumber' }, property: { name: 'total', type: 'number' }, transaction })`. `'synchronize'` changes a type by dropping the column and adding it again, so a column left to it loses its values.

**Text.** Every text column is created with the collation of your default locale, such as `en-x-icu`, so queries order text the way that locale does. Your postgres needs icu support, which the official images have. `'synchronize'` changes the collation of existing columns and rebuilds their indexes during the first start, which takes a while on large tables. With `'migrations'` or `'external'`, the application starts and logs the columns that still have another collation. `changePropertyOfEntity` gives a column the collation.

**Roles.** Roles are rows, see [roles and permissions](./roles-and-permissions.md#roles): declare a role entity extending `BaseRoleEntity` with `@Entity()` and its repository, see **Repositories** below, and declare it in the data source your users live in, next to `CacheInvalidation`; an application with users does not start without them. Create a row for every role your users and memberships hold, at the level it is held at, `'platform'` for the roles of a user and `'tenant'` for the roles of a membership, with no `tenantId`, in a migration that runs before anything else writes roles and outside every tenant. The name of a role is unique across both levels, so an enum used for both splits into two with different values, such as `Roles` and `MemberRoles`, and a migration renames the roles stored on your memberships. Users and memberships hold the names of roles: write `BaseUserEntity()` and `BaseMembershipEntity()`, and type a `UserRepositoryInterface` or `MembershipRepositoryInterface` with `string`. Your user repository and membership repository implement `updateRoles`, which writes them. An application does not start while a stored user or membership holds a role that no role of its level is. `BaseScimProvisioner` takes the user and the membership entity only, such as `BaseScimProvisioner<User, Membership>`.

**Permissions.** Every permission is declared in `ZIBRI_DI_TOKENS.PERMISSIONS`, made with `definePermissions` for those a tenant role carries and `definePlatformPermissions` for those a platform role carries, see [declaring permissions](./roles-and-permissions.md#declaring-permissions). Spread `ZIBRI_PERMISSIONS` and `ZIBRI_PLATFORM_PERMISSIONS` into them to let your administrators [manage roles](./roles-and-permissions.md#managing-roles). Routes and your code ask for a permission, never for a role: `@Auth.hasRole` and `@Auth.hasPlatformRole` are gone, and so are `hasRole` and `hasPlatformRole` of the `AuthService`. For each role check, declare a permission, let the roles it named carry it, and ask for it with `@Auth.hasPermission` where the check named roles of a membership, or `@Auth.hasPlatformPermission` where it named roles of the user's own; the `auth` of a manually registered route and `ZIBRI_DI_TOKENS.OPEN_API_AUTH` take `hasPermission` and `hasPlatformPermission` the same way. Each of these takes a `Permission` or a `PlatformPermission` from the two functions, and so do the `permission` of a SCIM controller, the `introspectionPermission` of an authorization server and the `permissions` of an api key: a plain string does not compile. The refusal is audited as `missing-permission`. The user `@CurrentUser()` and `resolveCurrentUser` hand you is a `CurrentUser<User>`: your user without `roles`, with the `permissions` and `platformPermissions` the request may use. Type the parameters, such as `@CurrentUser() user: CurrentUser<User>`, and read the permissions where your code read the roles. The membership `resolveCurrentMembership` answers and the user and membership a scope is told have no `roles` either; code that needs the roles stored, such as before giving somebody a role, reads them through the repository or `findActiveMembership` of the `MembershipService`. `isAllowedToConnect` of the websocket options gets a `CurrentUser`. The two factor service and methods take a `UserAccount`, a user without roles: a method of your own declares its user as `UserType extends UserAccount`, and `deliver` of a `CodeTwoFactorMethod` takes a `UserAccount`. The OpenAPI document carries no `x-roles` and `x-platform-roles`, and its explorer shows the permission of a route in `zibri-permissions-container` and `zibri-permission-badge`: rename the classes in your `assets/public/open-api/custom.css`.

**Call `resolveCurrentUser` of the `AuthService`** where your code called `getCurrentUser`. It takes the same arguments.

**Resolve what a route declares through `ZIBRI_DI_TOKENS.ROUTE_AUTH_SERVICE`.** `resolveIsLoggedInMetadata`, `resolveIsNotLoggedInMetadata` and `resolveRequire2faMetadata` are on the `RouteAuthServiceInterface` rather than the `AuthServiceInterface`, and answer at once rather than as a promise. An auth service of your own leaves them out.

**Repositories.** Every data source lists its repository classes in `repositories`, an empty list when it has none, see [writing a repository of your own](./data-source.md#writing-a-repository-of-your-own). `@UserRepo`, `@MembershipRepo` and `@RoleRepo` are gone. Declare your user, membership and role repositories with `@RepositoryFor`, such as `@RepositoryFor(User) export class UserRepository extends BaseUserRepository<User, UserCreateData>() {}`, `BaseMembershipRepository<Membership>()` and `BaseRoleRepository<Role>()`, and list them in the `repositories` of the data source declaring their entities; the application does not start while a user, membership or role entity has none there. A repository of your own declares no constructor: remove it, along with the `@InjectRepository` it was given, and reach anything else it needs through `inject`. A hook it passed to the constructor is an override of its `beforeSave`, `beforeDelete` or `beforeReturn` now, which calls the one of `super`; what a hook did for a delete goes into `beforeDelete`, see [running your own code on every row](./data-source.md#running-your-own-code-on-every-row). It is listed in `repositories` like the others, and `@InjectRepository` and `repositoryTokenFor` of its entity hand it out from then on.

**Users.** `BaseUserEntity` declares `deactivatedAt`, an optional date that says a user is [deactivated](./auth.md#deactivating-a-user), and `emailVerifiedAt`, an optional date that says their address is [verified](./email-verification.md). `'synchronize'` adds the columns; with `'migrations'` or `'external'`, add them to your user table yourself, for example with `addPropertyToEntity`. Every user repository implements `updateDeactivatedAt` and `updateEmail`, which write them, and takes a transaction in `findById` and `findByEmail`; a `MembershipRepositoryInterface` of your own takes one in `findMembership`. A `UserServiceInterface` of your own implements `getUserEntityClasses`, and an [auth strategy](./glossary.md#auth-strategy) of your own lists its `credentialEntities`, see [writing a strategy of your own](./auth.md#writing-a-strategy-of-your-own).

**[Soft delete](./glossary.md#soft-delete).** `SoftDeleteEntity` declares `deletedWith`, an optional string holding the row whose soft delete took this one along. `'synchronize'` adds the column; with `'migrations'` or `'external'`, add it to each soft deleting table yourself, for example with `addPropertyToEntity`. An entity that soft deletes and whose `oneToMany` or `hasOne` removes rows of an entity that does not refuses the start: extend `SoftDeleteEntity` on the target, or leave `'remove'` out of the relation's `cascade`.

**Models.** `before` and `after` of a `@Property.date` take a function returning the date, such as `after: () => new Date()` for a date in the future, see [bounding a date](./validation.md#bounding-a-date): a fixed date does not compile. A `ValidationProblem` your code builds, such as in a `ValidationServiceInterface` of your own, carries a `code`, see [reading a refused request](./validation.md#reading-a-refused-request).

**Names and tables.** Two entities of the same name in one application refuse the start, and so do two entities of one data source stored in the same table: rename all but one of them, or give it a `tableName` on `@Entity`. Two data source classes of the same name refuse it as well: rename all but one of them.

**Data sources.** A `RepositoryDriverInterface` of your own implements `insert`, which writes rows whose ids were generated for them, so no stored row holds one, and `updateEach`, which writes each row's own values to the stored row with its id among the rows a filter matches. Handing the rows of `insert` to your `save` is enough, and so is writing the rows of `updateEach` one at a time with your `updateAll`. Its `updateAll` adds the amounts in `increments` to what each matching row stores, in the same write as `data`, a property holding no value counting as 0. It implements `aggregate`, which takes a sum, an average, a smallest or largest value or a count over the matching rows, per group when asked; `AggregateUtilities.resolveRows` answers it from rows you already read. Its `remove` takes a `RemovalReach` after the ids: a filter the rows still have to match, judged in the same write, and `wholly`, which says that a row gone or no longer matching keeps every row from being removed. It answers with the ids it removed. It implements `removeMatching`, which removes every row a filter matches; your `findIds` followed by your `remove` with the filter as the reach is enough. It implements `resolveRelations`, which resolves relations on rows a write handed back; reading them again by their ids with your `find` is enough. Its `updateAll` refuses with an `UnboundedReturnError` before writing anything when more rows than `returnAtMost` match. Its `stream` hands the rows out in the `order` it is given, when there is one. A `Transaction` of your own implements `afterFinish`, which runs work once it is committed, rolled back or its commit failed, and tells the work whether it was committed. A `DataSourceInterface` of your own implements `runInTransaction`; `TransactionUtilities.runInTransaction(this, work, options)` answers it from your `startTransaction`.

**Metrics.** A `MetricsServiceInterface` of your own implements `addCollector`, which runs work that sets gauges before the metrics are read, and `resolveExposition`, which answers a Prometheus scrape, see [metrics](./metrics.md#adding-gauges-of-your-own).

**The http client.** An `HttpClientInterface` of your own implements `head` and `options`, see [making a request](./http-client.md#making-a-request).

**Polls.** The `dispatchPending` of an `EventServiceInterface` of your own resolves whether any event was due, and the `startQueuedJobs` of a `MultithreadingServiceInterface` of your own whether a job was started, see [how an instance finds work](./replication.md#how-an-instance-finds-work). A `PubSubDataSourceInterface` of your own declares `maxMessageBytes`, the largest message it carries, or `undefined` for any.

**Audit events.** The logger has no `audit`: record an event of your own with `record` of `ZIBRI_DI_TOKENS.AUDIT_SERVICE`, which keeps it in the [audit trail](./audit.md) and logs it. A logger of your own that sent `audit` somewhere no longer receives the events; provide an audit service of your own instead, see [keeping the trail elsewhere](./audit.md#keeping-the-trail-elsewhere).

## Behavior
### Cron schedules are read in UTC
2.x read a cron expression in the time zone of the machine it ran on. 3.0.0 reads it in UTC, so on a machine not set to UTC every job moves. To keep the times your jobs ran at, set the zone they were read in:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT,
    useValue: { defaultTimezone: 'Europe/Berlin' }
});
```

### A placeholder is numbered
`$t` numbers a placeholder by its position: `` $t`Hello ${name}` `` is `Hello {$1}`, and `source.xlf` lists it that way. A `<trans-unit>` of yours keyed by the expression, such as `Hello {name}`, is keyed `Hello {$1}` instead, with `{$1}` in its `<target>`. To keep a name, hand `$t` an object with one key: `` $t`Hello ${{ name }}` `` is `Hello {name}`, see [adding parameters to a string](./localization.md#adding-parameters-to-a-string).

### Overridable methods say what they cost
A method a class of yours overrides is named by what a call costs: `ChangeSetRepository.getCreatedBy` is `resolveCreatedBy` and `getChangesFromData` is `resolveChangesFromData`; `InvoiceNumberService.getConsecutiveNumber` is `resolveConsecutiveNumber` and `getTemporaryConsecutiveNumber` is `resolveTemporaryConsecutiveNumber`. An override keeps its body under the new name.

### An older build refuses a database a newer one migrated
2.x ran `down()` on boot for every migration newer than the application. An older build refuses to start against such a database instead, and names what to run: revert with the newer build first, then deploy the older one, see [going back](./data-source.md#going-back). For the commands that do it, start your application through `runCommand` in `src/index.ts`, and add the `migrate:list` and `migrate:down` scripts to your `package.json`, as `zi new` writes them.

### A `required` function is given the object it is on
A `required` function of a property inside an object, or an item of an array, is given that object or item, not the whole body. A function that read another part of the body reads the object it is on instead.

### Every user logs in once
Jwts name your application's `baseUrl` as their issuer, and access tokens name it as their audience too, see [what a jwt has to prove](./auth.md#what-a-jwt-has-to-prove). The tokens 2.x issued do not, so from the first start every access token and refresh token issued before the upgrade is refused with a `401`, and every user of `JwtAuthStrategy` logs in again. The migration deletes the cookie sessions, so every user of `CookieAuthStrategy` logs in again as well. Tell your users, or upgrade at a quiet time.

Every replica has to start with the same `baseUrl`, and changing it later logs everyone out again.

### A password reset ends every login
Confirming a password reset ends every login of that user, in every [auth strategy](./glossary.md#auth-strategy), not only in the one whose controller took the reset. Refresh tokens and sessions are deleted, and an access token works until it expires.

### The auth routes come from `AuthController`
`JwtAuthController` and `CookieAuthController` are replaced by the controller `AuthController` defines, see [the auth routes](./auth-routes.md). `zi new` writes it as `AppAuthController` in `src/controllers/auth.controller.ts`. The routes keep their paths and bodies, with these differences:

- `POST /auth/logout` answers `200` with a body, which carries a `providerLogoutUrl` when the user can log out at a provider as well, where 2.x answered `204`.
- A cookie logout ends the login of the cookies the request carries, and takes `{ "clearCookies" }` without a `refreshSessionId`.
- A request names its strategy in the query parameter `strategy` and its [authenticator](./glossary.md#authenticator) in `authenticator` once your auth controller has more than one of either.
- The application refuses to start when the options of your auth controller name other strategies, authenticators or two factor methods than the application registers.

### The mailing list routes are below a controller of your own
`MailingListController` has no path of its own. Extend it with a `@Controller` of your own and register that class instead, see [setting up the mailing list plugin](./mailing-list-plugin.md#setting-it-up). `@Controller('/mailing-lists', { versions: 'all' })` keeps the paths of 2.x. `zi new` writes it as `AppMailingListController` in `src/controllers/mailing-list.controller.ts`.

`mailingListBaseRoute` is gone from the mailing list service. The links in the emails point at the path of your controller, or below [`PAGES_URL`](./mailing-list-plugin.md#showing-the-pages-in-your-frontend) when your frontend shows the pages.

### Requests have limits
| Limit | Default | When it is exceeded |
|---|---|---|
| How long a route handler runs | 30 seconds | `504 Gateway Timeout` |
| Headers in a request | 100 | `431 Request Header Fields Too Large` |
| Files in a multipart body | 20 | `413 Content Too Large` |
| Parts in a multipart body | 1000 | `413 Content Too Large` |
| Fields in a multipart body | 500 | `413 Content Too Large` |

Raise them where you need to, see [deadlines](./creating-endpoints.md#deadlines), [how long a request may take](./application-lifecycle.md#how-long-a-request-may-take) and [limits on a multipart body](./creating-endpoints.md#limits-on-a-multipart-body).

### Statements have a time limit
A postgres statement that runs for longer than 30 seconds fails, outside a request as well: in a cron job, an event subscriber or a thread job. Give a call that legitimately takes longer a `timeoutInMs` of its own, or raise `statementTimeoutInMs` on the data source. Migrations and setting up the schema are not limited. See [data source](./data-source.md#how-long-a-call-may-take).

A call that waits longer than 30 seconds for a postgres connection fails as well. Set `connectTimeoutInMs` in the options of the data source to wait longer.

### A deadlock or a serialization failure fails with a `TransactionConflictError`
A transaction ended to break a deadlock fails with a `TransactionDeadlockError`, on postgres and on valkey. A `REPEATABLE READ` or `SERIALIZABLE` transaction ended because another one changed what it read fails with a `TransactionSerializationError`, at a statement or at its commit. Both are a `TransactionConflictError`. Code that recognized them by the query error's sql state `40P01` or `40001` catches these errors instead, or runs its work through `runInTransaction`, which runs it again, see [using transactions](./data-source.md#using-transactions).

### The auth routes and transactional hooks run in a `SpanningTransaction`
The auth routes, SCIM provisioning and event hooks delivered `'transactional'` hand your strategies, authenticators, two factor methods, provisioners and hooks a [transaction across data sources](./data-source.md#writing-to-several-data-sources-in-one-transaction). Type the transaction parameters of yours as `RepositoryTransaction`. One that hands the transaction to an operation of a data source itself, such as a query written by hand, starts a transaction of that data source for it instead.

### The http client stops calling an upstream that keeps failing
After 5 failures in a row, a connection error, a timeout or a `500`, `502`, `503` or `504`, every request of the http client to that origin fails at once with a `CircuitOpenError` for 30 seconds, without being sent. Code that catches a failed upstream call and tries again in a loop gets this error instead of a timeout. Set other thresholds, or turn it off, with `circuitBreaker` in `HTTP_CLIENT_OPTIONS_INPUT`, see [when an upstream keeps failing](./http-client.md#when-an-upstream-keeps-failing).

### A redirect from https to http fails the request
A request of the http client answered with a redirect from https to http fails with an `HttpClientError` carrying the redirect, without following it. Point the request at the address the redirect names, over https, see [following redirects](./http-client.md#following-redirects).

### A backup is queued, and `queueBackup` answers before it is stored
`createBackup` is `queueBackup`. It queues the backup and answers with it, `RUNNING`, while its resources are stored on whichever instance claims each. Wait for it with `waitForBackup`, which answers once it is `COMPLETED` and fails with a `BackupFailedError` when a resource spent its attempts, see [creating and restoring backups](./backup.md#creating-and-restoring-backups). A resource whose transport fails is tried again, 3 times by default. A `BackupServiceInterface` of your own implements `waitForBackup` and `runQueuedBackups`.

When the application stops during a backup, the resource it is storing is handed to another instance. A running restore stops before its next resource and puts back what it applied. To let them finish, set `ZIBRI_DI_TOKENS.BACKUP_SHUTDOWN_WAIT_IN_MS` to how long the application waits for them, within the time your orchestrator gives the process before it kills it, see [when the application stops](./backup.md#when-the-application-stops).

### A backed up data source says what its backup covers
A postgres data source marked with `@Backup` refuses to start without `backupScope`. Set `'schema'` to keep backing up everything in the schema it works in, or `'entity-tables'` when anything else keeps tables in that schema. A valkey data source marked with `@Backup` refuses to start without `backupMode`: `'snapshot'` to read every key at one moment, or `'walk'` to read them a batch at a time, see [backup](./backup.md).

### Pages on other origins may not send cookies with writes
A request other than `GET`, `HEAD` and `OPTIONS` that a page on another origin sends with cookies is answered `403`, on every route, unless that origin is listed in `cors.origins` with `credentials: true`. A front end on a sibling subdomain counts as another origin. List every origin your front ends are served from, see [app settings](./app-settings.md#what-a-request-from-a-disallowed-origin-does).

### An access token carries no email
The access tokens of `JwtAuthStrategy` and those [issued to services](./authorization-server.md) name their user by id and carry no `email`. A frontend that read the user's email from the access token reads it from a route of your own, such as one answering the `@CurrentUser`.

### A cookie session without its CSRF token is answered `403`
A request that changes something, carries a valid cookie session and sends no CSRF token or a wrong one is answered `403` on a route that needs a login, where 2.x answered `401`. A front end that logs the user in again on every `401` reads the current token from `GET /auth/csrf-token` on this `403` instead, see [sending the CSRF token](./auth.md#sending-the-csrf-token).

### Reading a whole table needs `limit: 'all'`
A `findAll` without `limit` is refused once it would return more than ten thousand rows. It works while your tables are small and fails once one grows. Search for `findAll` calls without a `limit`, and give each one a number or `limit: 'all'`. See [data source](./data-source.md#accessing-the-data-source).

### Pages are whole numbers
A page and a `limit` below 1, an `offset` below 0, or a fraction of any of them throws. The `findAll` route of a `CrudController` answers such a `page` or `limit` with a 400, and a `limit` above 100 as well; pass `maxLimit` as its fourth argument to allow larger pages. See [creating endpoints](./creating-endpoints.md#extending-a-controller).

### Soft deleted rows are chosen by the `deleted` option
`withDeleted: true` is `deleted: 'include'`, and `deleted: 'only'` reaches soft deleted rows alone. A filter that still names `deleted` with a value the option does not give it, such as one typed as the entity's own `Where`, is refused. `deleteById` with `hardDelete: true` removes a row that is already soft deleted, and an `updateById` setting `deleted: true` on such a row answers `404`. See [data source](./data-source.md#soft-deleting-rows).

### The rows of a relation are written through their own repository
A `oneToMany` or `hasOne` value given to a write is the whole relation: a row there already that the value leaves out is deleted, or unlinked when its foreign key is optional. Its rows are written through the repository of their own entity, so its scope, hooks and change sets apply to them, and a row given by an `id` you may not see refuses the write. `updateAll` refuses a row given by its `id` when it matches more than one row. Soft deleting a row soft deletes the rows its relations remove, and restoring it restores them. Hard deleting a row that rows of a relation without `'remove'` still point at throws a `ConflictError` on every data source, so unlink or delete them first. Hard deleting a row deletes its change sets as well. See [data source](./data-source.md#saving-and-deleting-the-rows-of-a-relation).

### Excluding a value a property cannot hold is refused
A filter like `{ ownerId: { not: 'abc' } }` on a uuid property fails with a `BadRequestError`, on every data source. Check filters built from request input, see [data source](./data-source.md#accessing-the-data-source).

### `isIncludedIn` finds no empty array
`isIncludedIn` finds the arrays and relations that hold at least one item, each of them listed, so a row with an empty array or without related rows is left out, and `{ isIncludedIn: [] }` finds nothing. A missing array is found by `null` alone: `includes`, `isIncludedIn` and the length operators leave it out on every data source. Where a filter has to find the empty ones too, add a branch with `{ length: 0 }`, see [data source](./data-source.md#filtering-an-array).

### The correlation id is a trace id
The `x-correlation-id` header is gone. The id of a request is returned as `traceresponse`, and a failed request repeats it in its body as `traceId`. Update clients and log queries that read the old header, see [logging](./logging.md).

### Metrics are labeled by route
The `route` label of `http_requests_total` and `http_request_duration_seconds` is the route template, such as `/invoices/:id`, not the url that was requested. Update dashboards and alerts that filter on urls, see [metrics](./metrics.md).

### Durations are measured in seconds
`http_request_duration_ms`, `cache_store_duration_ms` and `cache_source_duration_ms` are `http_request_duration_seconds`, `cache_store_duration_seconds` and `cache_source_duration_seconds`, and their values and buckets are in seconds. `METRICS_REQUEST_DURATION_BUCKETS_IN_MS` stays in milliseconds. Update dashboards and alerts that read the old names, see [metrics](./metrics.md#what-a-snapshot-contains).

### The db logger transport writes 1000 rows a minute
Past 1000 entries a minute on an instance, the db transport writes one row per kind of entry, which counts how many it stands for in `context.collapsed`. Queries that count log rows add up `context.collapsed.count` instead. Pass `maxEntriesPerMinute` to `LoggerTransport.db` where you need more rows, see [logging](./logging.md#how-many-rows-the-db-transport-writes).

### A websocket connection that does not answer reports a `LoggedError`
`sendToChannel` and `sendToAll` with `expectResponse: true` return a `WebsocketAnswer` per connection, on every instance. A connection that did not answer in time holds a `LoggedError` in `request.body.error`, not an `Error`. Code checking it with `instanceof Error` reads `name` and `paragraphs` instead, see [websocket](./websocket.md#waiting-for-answers).

### A reconnecting websocket client names its `offset`
The websocket server has no socket.io connection state recovery, and `SocketIOWebsocketConnection.recovered` is gone. A client that reconnects is sent what it missed when it sends the `seq` of the last message it received as `offset`, on any instance. Clients that relied on socket.io to send them missed messages send their `offset`, see [reconnecting](./websocket.md#reconnecting).

### A websocket message weighs at most what its body allows
A message for an event with a `@WebsocketBody` is refused once it is larger than the body's `maxSize`, or than `maxBodySizes.json` of `ZIBRI_DI_TOKENS.HTTP_SERVER_LIMITS`, 100 kilobytes, when it names none, and the connection is closed with code `1009`. An event that takes larger messages names a `maxSize`, see [limiting the size of a message](./websocket.md#limiting-the-size-of-a-message).

### A `ValKeyCacheStore` belongs to one cache
A `ValKeyCacheStore` keeps its entries under the name of the cache it is given to, and a store given to a second cache is refused. Give each cache a store of its own. What the stores held before is not read again: delete the keys under `<keyPrefix>:cache:` that name no cache, such as `<keyPrefix>:cache:index`, see [caching](./caching.md#using-a-cache).

### `sendBatchSize` is at most `maxEmailsPerHour`
An `EMAIL_CONFIG` whose `sendBatchSize` is larger than its `maxEmailsPerHour` is refused at startup. Lower `sendBatchSize` to at most `maxEmailsPerHour`, see [email](./email.md).

### `SmtpEmailTransport` refuses a server without STARTTLS
A connection that is not `secure` is upgraded with STARTTLS, and a server that offers none is refused, so a mail fails to send. Pass `requireTls: false` for a relay that speaks no TLS, such as one on the same machine, see [reaching the SMTP server](./email.md#reaching-the-smtp-server).

### `formatPercent` takes the number of percent
`formatPercent` and `$f.percent` format `19` as `19 %`, with up to three decimals. Multiply a share such as `0.19` by 100 before you pass it, see [formatting](./localization.md#formatting).
