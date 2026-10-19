# Upgrading to 3
Most of what 3.0.0 changes, the compiler tells you about: removed exports, renamed options, options that are now required, templates moving from preact to `zibri-tsx`. Install the new versions, run `tsc`, and work through the errors.

This page covers what compiles and still breaks: things that fail on the first start, lock users out, lose data or quietly behave differently. Go through it before you deploy.

## Before the first start
**Back up your database.** The migration below changes tables that already hold data.

**Use node 24 or newer.**

**Install the packages you use.** `pg` used to come with Zibri, and every other package it needed was installed with it. Now each feature asks for its own, and the application names the missing one while it starts. The full list is in [getting started](./getting-started.md#optional-packages).

**Check your `regex` declarations.** A `regex` on a string property or parameter needs `re2`, and one with lookarounds or backreferences is refused while the application starts, see [models](./models.md).

**Keep bcrypt.** Every password hash written by 2.x is a bcrypt hash, and bcrypt is no longer one of the default hash strategies. The application refuses to start with `There are missing strategies: bcrypt` until you add it back:

```ts
import { BcryptHashStrategy, defineProvider, ScryptHashStrategy, Sha256HashStrategy, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.HASH_STRATEGIES,
    useValue: [ScryptHashStrategy, Sha256HashStrategy, BcryptHashStrategy]
});
```

The migration below marks bcrypt `DEPRECATED` and scrypt as the default, so each password is replaced with a scrypt hash the next time its user signs in. `BcryptHashStrategy` is deprecated: keep it registered while stored hashes need it.

**Compare your build with a new project.** Templates are compiled by `zibri-tsx` now, which needs `"jsxImportSource": "zibri-tsx"` in `tsconfig.json` and its loader in the webpack config. Run `zi new` somewhere else and copy what differs.

**Choose how your schema is managed.** `schemaManagement` is required on every sql data source, see [data source](./data-source.md). 2.x synchronized the schema unless you turned it off.

**Say whether your connections use tls.** `ssl` on every postgres data source and `useTLS` on every valkey data source are required, see [data source](./data-source.md). The `PGSSLMODE` environment variable does not apply to the postgres connection: if yours took its tls from there, set `ssl` instead.

**Say how long failures are kept.** `failedRetentionInMs` is required in your `EMAIL_CONFIG`, and your providers need `ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS`, which the application refuses to start without: a number of milliseconds, or `'forever'`. A failed mail or event is deleted once it is older, see [email](./email.md#what-happens-to-the-row) and [events](./events.md#when-an-event-cannot-be-handled).

## The migration
Every 2.x database needs the same changes to the entities Zibri ships. Copy these three migrations into your data source and list them first in its `migrations`, in this order. They work under every `schemaManagement`, and skip what your data source does not hold. Run them against a copy of your production database before you deploy.

```ts
// src/data-sources/db/migrations/upgrade-to-zibri-3.migration.ts
import { ArrayPropertyMetadataInput, BackupEntity, BackupResourceEntity, BaseEntity, CacheInvalidation, Change, ChangeSet, CookieAuthRefreshSession, CookieAuthSession, CronJobEntity, CronJobState, Email, EncryptionRotationFailure, EncryptionRotationProgress, Event, EventSubscriberRegistration, EventSubscriberRun, EventSubscriberRunStatus, HashStrategyEntity, HashStrategyEntityCreateData, HashStrategyStatus, HttpStatus, Injectable, Invoice, InvoiceRecipientAbbreviation, JwtRefreshToken, Lease, Log, LoggedError, LogLevel, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken, MasterKeyReference, Migration, Newable, NumberInvoices, NumberPropertyMetadataInput, OtpCredentials, PasswordCredentials, PasswordResetToken, Payment, RateLimitStateEntity, Repository, SemVerVersion, ThreadJobEntity, timezoneEnum, Transaction, TwoFactorFailureStreak, TwoFactorRecoveryCode, ValueConversion, WebsocketChannel, WebsocketMessage } from 'zibri';

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
        if (this.holds(RateLimitStateEntity)) {
            await this.dataSource.createEntity({
                entity: RateLimitStateEntity,
                properties: {
                    key: { type: 'string' },
                    expiresAtMs: { type: 'number' },
                    nextReservationExpiryMs: { type: 'number', required: false },
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
    }

    // 2.x recorded bcrypt as the default strategy, which every new hash would otherwise still use.
    // A deprecated strategy's hashes are replaced on their user's next login
    private async retireBcrypt(transaction: Transaction): Promise<void> {
        if (!this.holds(HashStrategyEntity)) {
            return;
        }
        const strategies: Repository<HashStrategyEntity, HashStrategyEntityCreateData> = this.dataSource.getRepository(HashStrategyEntity);
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
            [ThreadJobEntity, 'timeout', { type: 'number' }],
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
            property: { name: 'catchUpWithinMs', type: 'number', required: false },
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
            property: { name: 'nextRetryAt', type: 'date', required: false },
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
                property: { name: 'retryAt', type: 'date', required: false },
                transaction
            });
        }
        // the trace a job was queued in, which no job 2.x queued was
        if (this.holds(ThreadJobEntity)) {
            for (const name of ['traceparent', 'tracestate']) {
                await this.dataSource.addPropertyToEntity({ entity: ThreadJobEntity, property: { name, type: 'string', required: false }, transaction });
            }
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
        }
        if (this.holds(PasswordResetToken)) {
            await this.dataSource.getRepository(PasswordResetToken).deleteAll({}, { transaction });
        }
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
        const stored: OtpCredentials[] = await credentials.findAll({ take: 'all', autoDecrypt: false, transaction });
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
        const stored: MailingListSubscriber[] = await subscribers.findAll({ take: 'all', acrossTenants: true, autoDecrypt: false, transaction });
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
| New entities are created | Leases, cache invalidations, event subscriber registrations, rate limit state, two factor failure streaks, recovery codes, the name abbreviations of invoice recipients, and the progress and failures of the [key rotation](./encryption-and-hashing.md#rotating-a-key) each have a table of their own |
| The passwords move from `jwt_credentials` and `cookie_auth_credentials` to `PasswordCredentials`, without the email | Every login reads them from there |
| bcrypt is marked `DEPRECATED` in the hash strategy table, and scrypt the default | New passwords are hashed with scrypt, and each bcrypt hash is replaced with one the next time its user signs in |
| Number columns without a format become doubles | 2.x stored them as decimals |
| A cron job's `active` becomes `state`, and `timezone` is added | Both are required |
| A cron job gets `source`, `'code'` for every job 2.x stored | `cronService.update()` refuses a job declared in code; `enable`, `disable` and `changeCron` change it on every instance, see [changing a job while the app runs](./cron.md#behaviour) |
| A cron job loses `stopOnError`, and gets `consecutiveFailures` and `backedOffUntil` | A job declares what it does on a failure as `onFailure` in its class, `stopOnError: true` as `onFailure: { stopAfterFailures: 1 }`. The failures are counted on the row, see [when a tick throws](./cron.md#when-a-tick-throws) |
| An event subscriber run gets `status`, `attempts` and `finishedAt` | Both are required. A run 2.x recorded with an error counts as failed, and every run counts as finished at the upgrade |
| Backups 2.x took are marked as format `0`, and record no keys in `masterKeys` and `dataKeyIds` | A restore refuses them by name instead of misreading them, so they need no key |
| Cookie sessions and cookie refresh sessions are deleted, and get `token` | The cookies carry a token, stored hashed. Every user of `CookieAuthStrategy` signs in again, see [every user signs in once](#every-user-signs-in-once) |
| A cookie refresh session loses `csrfToken`, and gets `authenticatedAt` | The csrf token is derived from the session's token. `authenticatedAt` is when its user logged in, which a route accepting a [recent login](./two-factor.md#accepting-a-recent-login-instead) reads |
| Refresh tokens and cookie refresh sessions get `federatedProvider`, `federatedSubjectKey`, `federatedSessionKey` and `federatedLogout` | The provider a login was started at, which a logout there finds the login by, see [logging out](./sign-in-through-a-provider.md#logging-out) |
| Refresh tokens and password reset tokens are deleted | They are stored hashed now. Every user signs in again, see [every user signs in once](#every-user-signs-in-once), and reset links sent before the upgrade stop working |
| A refresh token gets `dpopKeyThumbprint` | The DPoP key its login is bound to, see [binding tokens to a key](./dpop.md) |
| One time password secrets are encrypted | They are stored encrypted now, and reading one stored as it is fails. Users with two factor authentication cannot sign in before this has run |
| Events, event subscriber runs, thread jobs, emails, logs, change sets, changes, websocket channels and websocket messages get `tenantId` | The [tenant](./tenancy.md#work-outside-a-request) each was started in. What 2.x stored belongs to no tenant, so every tenant sees it |
| Invoices, invoice counters, mailing lists, their subscribers and confirmation tokens, and payments get `tenantId` | Each belongs to a [tenant](./tenancy.md). What 2.x stored belongs to the tenant `TENANT_ID` names |
| Mailing list confirmation tokens are deleted, and get `spent` | They are stored hashed now, and confirm once. Confirmation links sent before the upgrade stop working |
| Emails get `listUnsubscribeUrl` | The [one-click unsubscribe](./email.md#sending-through-something-other-than-smtp) of a mail sent to a mailing list |
| Thread jobs get `traceparent` and `tracestate` | The [trace](./tracing.md#what-the-framework-records) a job was queued in, which its run is recorded under |
| Emails get `attempts` and `retryAt` | How many times sending a mail threw, and when it is [tried again](./email.md#what-happens-to-the-row). A mail is `FAILED` after `maxSendAttempts` such attempts |
| Each mailing list subscriber gets a `secret` of their own, stored encrypted | The links to unsubscribe and to manage preferences carry it. Links in mails sent before the upgrade answer `400` |

`EncryptOtpSecretsMigration` and `AddMailingListSecretsMigration` are migrations of their own so that they run after the schema changes are committed.

Once they have run, the first start [keeps the indexes and uniques](./data-source.md#keeping-indexes-and-uniques) the entities declare: the uniques 2.x created are replaced by ones named the way an upsert refers to them, and the ones new in 3.x are added.

**When it fails.** A new unique fails the first start when the rows already stored break it, and the error names the values they share. Remove the duplicates in a migration listed after these two. **Never delete an encryption key**, because what was encrypted with it cannot be read without it. For a strategy with more than one `DEFAULT` key, set all but one of them to `'ACTIVE'`. For a duplicated strategy, point the keys of one at the other before deleting it. An event subscriber run whose error is not an empty object fails the conversion with that error, and you list it in `values`. A number that a double cannot hold exactly, like `0.1234567890123456789`, fails the conversion with that number. Give that property `format: 'bignumber'` instead and leave it out of `retypeNumbers`.

## Your own entities
**Tenants.** Every entity holds the tenant of its rows in the uuid `tenantId`, unless it names another property or is shared, see [tenants](./tenancy.md); the compiler names each one that has no such property, and a tenant property that is not `@Property.string({ format: 'uuid' })` refuses the start. Declare `tenant: 'shared'` on what every tenant shares, such as your users. For an entity whose rows belong to a tenant, add its tenant property in a migration, eg. with `addPropertyToEntity`, `required: false` first, fill it in on the rows already stored, and then make it required. An application with one tenant gives every row that tenant's id, a uuid it picks once. On the first start, every unique and index of such an entity is replaced by one that starts with the tenant, and a relation between such an entity and a shared one refuses the start: keep the id of the shared row in a column instead.

**Memberships.** A request acts in the tenant its `x-tenant-id` header names; override `resolveTenant` in a `TenantService` of your own to read it from somewhere else, see [the tenant of a request](./tenancy.md#the-tenant-of-a-request). A logged in user acts in a tenant through their membership in it, so an application with users declares a membership entity, eg. one extending `BaseMembershipEntity(Roles)`, and marks its repository with `@MembershipRepo()`; it does not start otherwise. `@Auth.hasRole` checks the roles of that membership: give each user a membership with the roles they need there, in a migration, and turn the checks that are about the user's own roles into `@Auth.hasPlatformRole`. `createApiKey` takes `tenantId`: `undefined` keeps a key acting wherever its user is a member. Your membership repository implements `resolveMembership`, `updateDeactivatedAt` and `deleteMembership` too, and a `TenantService` of your own `resolveTenantUrl`, which puts the tenant into a link the way `resolveTenant` reads it, see [the tenant of a request](./tenancy.md#the-tenant-of-a-request).

**Plugins.** Invoices, payments and mailing lists belong to a tenant. The invoicing plugin needs `InvoiceRecipientAbbreviation` in your data source's `entities`: each recipient's invoice numbers carry an abbreviation only they hold, see [the invoicing plugin](./plugin.md#zibriinvoicingplugin). Invoice amounts are rounded to the minor units of their currency, and the tax of each tax group is taxed once rather than summed from its items, so a total can differ from what 2.x calculated by a cent. An invoice totalling less than 0 is refused. An XRechnung names its guideline `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0`, the identifier of XRechnung 3.0. A Peppol invoice requires the `electronicAddress` of the company and of the customer, see [the invoicing plugin](./plugin.md#zibriinvoicingplugin). An `EN16931ConformanceService` of your own checks an invoice in `validateInvoice` and names a party in `resolveElectronicAddress`. The item methods of `InvoiceCalcServiceInterface` take the invoice's currency after the item, and one of your own implements `getTaxGroups`; a `LocalizeServiceInterface` of your own implements `getCurrencyMinorUnits`. The `amount` of a payment and of `PayPalPaymentData` is a `BigNumber`, eg. `new BigNumber('9.99')`, with at most the decimals of its currency, see [the payment plugin](./plugin.md#zibripaymentplugin). The invoicing plugin reads the company of each tenant from a service under `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.COMPANY_INFO_SERVICE`, see [the invoicing plugin](./plugin.md#zibriinvoicingplugin): move `companyInfo`, `logo`, `bankName` and `taxOffice` out of `OPTIONS_INPUT` into it. The links of the mailing list plugin are resolved with `resolveSubscribeConfirmationLink`, `resolveUnsubscribeLink` and `resolveManagePreferencesLink`, which name the tenant, and the base email template gets `unsubscribeLink` and `managePreferencesLink` instead of building them. `confirmSubscribeToList` takes the id of the list the link names ahead of the token, and an address already on other lists confirms a new one like any other address. `resolveUnsubscribeLink` and `resolveManagePreferencesLink` take the subscriber instead of their id, and a `MailingListServiceInterface` of your own implements `resolveSubscriberOfLink`. Opening an unsubscribe link no longer unsubscribes: the `UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE` gets `unsubscribed` and `unsubscribeUrl`, and renders a form posting to it while `unsubscribed` is false, see [the mailing list plugin](./plugin.md#zibrimailinglistplugin). A link in an email sent before the upgrade names no tenant and answers `400`; an application with one tenant can read that tenant for such a request in its own `resolveTenant`.

**SCIM.** Each tenant's identity provider provisions that tenant, see [provisioning through SCIM](./scim.md): give it an api key bound to the tenant, of a member holding one of the controller's `roles` there. A provisioner implements `findProvisionedUser` and `createProvisionedUser` in place of `resolveProvisionedUser`, and `resolveGroupMembership` gets the membership in the tenant instead of the user.

**Work outside a request.** An event, a queued thread job or email, a log entry, a change set and a websocket channel or message belong to the tenant they were started in, see [work outside a request](./tenancy.md#work-outside-a-request). A cron job runs outside every tenant, so one that reads a tenant's rows uses `runAs` or `acrossTenants`. `sendToAll` inside a tenant reaches the connections of its members only, and a websocket channel's name is unique within its tenant. A cache key holds the active tenant, so a cache filled outside a tenant is empty inside one. A `Transaction`, `MembershipServiceInterface` or `WebsocketServiceInterface` of your own implements `afterCommit`, `isMembershipEntity` and `handleMembershipsChanged`, or `updateTenantRooms`. An `EventServiceInterface` of your own implements `dispatchPending`, `refreshSubscriberRegistrations` and `replayFailed`, see [events](./events.md), and an `EmailServiceInterface` of your own `deleteExpiredFailedEmails`.

**Numbers.** A `@Property.number()` without a `format` is stored as a double, not as a decimal. For each of yours, either give it `format: 'bignumber'`, which keeps it an exact decimal and makes the property a `BigNumber`, or convert it in a migration the way `retypeNumbers` above does, eg. `changePropertyOfEntity({ entity: Order, currentProperty: { name: 'total', type: 'number', format: 'bignumber' }, property: { name: 'total', type: 'number' }, transaction })`. `'synchronize'` changes a type by dropping the column and adding it again, so a column left to it loses its values.

**Text.** Every text column is created with the collation of your default locale, eg. `en-x-icu`, so queries order text the way that locale does. Your postgres needs icu support, which the official images have. `'synchronize'` changes the collation of existing columns and rebuilds their indexes during the first start, which takes a while on large tables. With `'migrations'` or `'external'`, the application starts and logs the columns that still have another collation. `changePropertyOfEntity` gives a column the collation.

**Users.** `BaseUserEntity` declares `deactivatedAt`, an optional date that says a user is [deactivated](./auth.md#deactivating-a-user). `'synchronize'` adds the column; with `'migrations'` or `'external'`, add it to your user table yourself, eg. with `addPropertyToEntity`. Every user repository implements `updateDeactivatedAt`, which writes it.

**Soft delete.** `SoftDeleteEntity` declares `deletedWith`, an optional string holding the row whose soft delete took this one along. `'synchronize'` adds the column; with `'migrations'` or `'external'`, add it to each soft deleting table yourself, eg. with `addPropertyToEntity`. An entity that soft deletes and whose `oneToMany` or `hasOne` removes rows of an entity that does not refuses the start: extend `SoftDeleteEntity` on the target, or leave `'remove'` out of the relation's `cascade`.

**Names and tables.** Two entities of the same name in one application refuse the start, and so do two entities of one data source stored in the same table: rename all but one of them, or give it a `tableName` on `@Entity`.

**Data sources.** A `RepositoryDriverInterface` of your own implements `insert`, which writes rows whose ids were generated for them, so no stored row holds one, and `updateEach`, which writes each row's own values to the stored row with its id among the rows a filter matches. Handing the rows of `insert` to your `save` is enough, and so is writing the rows of `updateEach` one at a time with your `updateAll`. A `Transaction` of your own implements `afterFinish`, which runs work once it is committed, rolled back or its commit failed, and tells the work whether it was committed.

## Behavior
### Cron schedules are read in UTC
2.x read a cron expression in the time zone of the machine it ran on. 3.0.0 reads it in UTC, so on a machine not set to UTC every job moves. To keep the times your jobs ran at, set the zone they were read in:

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT,
    useValue: { defaultTimezone: 'Europe/Berlin' }
});
```

### Every user signs in once
Jwts name your application's `baseUrl` as their issuer, and access tokens name it as their audience too, see [what a jwt has to prove](./auth.md#what-a-jwt-has-to-prove). The tokens 2.x issued do not, so from the first start every access token and refresh token issued before the upgrade is refused with a `401`, and every user of `JwtAuthStrategy` logs in again. The migration deletes the cookie sessions, so every user of `CookieAuthStrategy` logs in again as well. Tell your users, or upgrade at a quiet time.

Every replica has to start with the same `baseUrl`, and changing it later logs everyone out again.

### A password reset ends every login
Confirming a password reset ends every login of that user, in every auth strategy, not only in the one whose controller took the reset. Refresh tokens and sessions are deleted, and an access token works until it expires.

### The auth routes come from `AuthController`
`JwtAuthController` and `CookieAuthController` are replaced by the controller `AuthController` defines, see [the auth routes](./auth-routes.md). `zi new` writes it as `AppAuthController` in `src/controllers/auth.controller.ts`. The routes keep their paths and bodies, with these differences:

- `POST /auth/logout` answers `200` with a body, which carries a `providerLogoutUrl` when the user can log out at a provider as well, where 2.x answered `204`.
- A cookie logout ends the login of the cookies the request carries, and takes `{ "clearCookies" }` without a `refreshSessionId`.
- A request names its strategy in the query parameter `strategy` and its authenticator in `authenticator` once your auth controller has more than one of either.
- The application refuses to start when the options of your auth controller name other strategies, authenticators or two factor methods than the application registers.

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

A call that waits longer than 30 seconds for a postgres connection fails as well. Set `connectTimeoutMS` in the options of the data source to wait longer.

### The http client stops calling an upstream that keeps failing
After 5 failures in a row, a connection error, a timeout or a `500`, `502`, `503` or `504`, every request of the http client to that origin fails at once with a `CircuitOpenError` for 30 seconds, without being sent. Code that catches a failed upstream call and tries again in a loop gets this error instead of a timeout. Set other thresholds, or turn it off, with `circuitBreaker` in `HTTP_CLIENT_OPTIONS_INPUT`, see [when an upstream keeps failing](./http-client.md#when-an-upstream-keeps-failing).

### A running backup is stopped when the application stops
When the application stops during a backup, the backup is stopped at once and deleted, and `createBackup` fails. A running restore stops before its next resource and puts back what it applied. To let them finish, set `ZIBRI_DI_TOKENS.BACKUP_SHUTDOWN_WAIT_IN_MS` to how long the application waits for them, within the time your orchestrator gives the process before it kills it, see [when the application stops](./backup.md#when-the-application-stops).

### Pages on other origins may not send cookies with writes
A request other than `GET`, `HEAD` and `OPTIONS` that a page on another origin sends with cookies is answered `403`, on every route, unless that origin is listed in `cors.origins` with `credentials: true`. A front end on a sibling subdomain counts as another origin. List every origin your front ends are served from, see [app settings](./app-settings.md#what-a-request-from-a-disallowed-origin-does).

### Reading a whole table needs `take: 'all'`
A `findAll` without `take` is refused once it would return more than ten thousand rows. It works while your tables are small and fails once one grows. Search for `findAll` calls without a `take`, and give each one a limit or `take: 'all'`. See [data source](./data-source.md#accessing-the-data-source).

### Pages are whole numbers
A page, a limit and a `take` below 1, a `skip` below 0, or a fraction of any of them throws. The `findAll` route of a `CrudController` answers such a `page` or `limit` with a 400, and a `limit` above 100 as well; pass `maxLimit` as its fourth argument to allow larger pages. See [creating endpoints](./creating-endpoints.md#inheritance-for-controllers).

### Soft deleted rows are chosen by the `deleted` option
`withDeleted: true` is `deleted: 'include'`, and `deleted: 'only'` reaches soft deleted rows alone. A filter that still names `deleted` with a value the option does not give it, eg. one typed as the entity's own `Where`, is refused. `deleteById` with `hardDelete: true` removes a row that is already soft deleted, and an `updateById` setting `deleted: true` on such a row answers `404`. See [data source](./data-source.md#softdeleterepository).

### The rows of a relation are written through their own repository
A `oneToMany` or `hasOne` value given to a write is the whole relation: a row there already that the value leaves out is deleted, or unlinked when its foreign key is optional. Its rows are written through the repository of their own entity, so its scope, hooks and change sets apply to them, and a row given by an `id` you may not see refuses the write. `updateAll` refuses a row given by its `id` when it matches more than one row. Soft deleting a row soft deletes the rows its relations remove, and restoring it restores them. Hard deleting a row that rows of a relation without `'remove'` still point at throws a `ConflictError` on every data source, so unlink or delete them first. Hard deleting a row deletes its change sets as well. See [data source](./data-source.md#saving-and-deleting-the-rows-of-a-relation).

### Excluding a value a property cannot hold is refused
A filter like `{ ownerId: { not: 'abc' } }` on a uuid property fails with a `BadRequestError`, on every data source. Check filters built from request input, see [data source](./data-source.md#accessing-the-data-source).

### `isIncludedIn` finds no empty array
`isIncludedIn` finds the arrays and relations that hold at least one item, each of them listed, so a row with an empty array or without related rows is left out, and `{ isIncludedIn: [] }` finds nothing. A missing array is found by `null` alone: `includes`, `isIncludedIn` and the length operators leave it out on every data source. Where a filter has to find the empty ones too, add a branch with `{ length: 0 }`, see [data source](./data-source.md#filtering-an-array).

### The correlation id is a trace id
The `x-correlation-id` header is gone. The id of a request is returned as `traceresponse`, and a failed request repeats it in its body as `traceId`. Update clients and log queries that read the old header, see [logging](./logging.md).

### Metrics are labeled by route
The `route` label of `http_requests_total` and `http_request_duration_ms` is the route template, eg. `/invoices/:id`, not the url that was requested. Update dashboards and alerts that filter on urls, see [metrics](./metrics.md).

### The db logger transport writes 1000 rows a minute
Past 1000 entries a minute on an instance, the db transport writes one row per kind of entry, which counts how many it stands for in `context.collapsed`. Queries that count log rows, eg. refused logins in the audit trail, add up `context.collapsed.count` instead. Pass `maxEntriesPerMinute` to `LoggerTransport.db` where you need more rows, see [logging](./logging.md#how-many-rows-the-db-transport-writes).

### A websocket connection that does not answer reports a `LoggedError`
`sendToChannel` and `sendToAll` with `expectResponse: true` return a `WebsocketAnswer` per connection, on every instance. A connection that did not answer in time holds a `LoggedError` in `request.body.error`, not an `Error`. Code checking it with `instanceof Error` reads `name` and `paragraphs` instead, see [websocket](./websocket.md#waiting-for-answers).
