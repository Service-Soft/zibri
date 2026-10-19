import { BaseEntity, BackupEntity, BackupResourceEntity, CacheInvalidation, Change, ChangeSet, CronJobEntity, Email, EncryptionKey, EncryptionRotationFailure, EncryptionRotationProgress, EncryptionStrategyEntity, Entity, Event, EventSubscriberRegistration, EventSubscriberRun, HashStrategyEntity, Invoice, InvoiceRecipientAbbreviation, JwtRefreshToken, Lease, Log, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken, MigrationEntity, Newable, NumberInvoices, OmitClass, OtpCredentials, PasswordCredentials, PasswordResetToken, ThreadJobEntity, TwoFactorFailureStreak, WebsocketChannel, WebsocketMessage, WebsocketMessageSequence } from 'zibri';

import { Company, Membership, Test, User } from '../../models';

@Entity({ tenant: 'shared' })
class Test2 extends OmitClass(MigrationEntity, ['ranAt']) {}

/**
 * Everything this application stores.
 *
 * Its own on top of the ones the framework and its plugins keep rows in. Declared here rather than
 * on the data source so that a test can put the same entities into a data source of its own without
 * the list drifting from the one production uses.
 */
export const entities: Newable<BaseEntity>[] = [
    MigrationEntity,
    Test,
    User,
    Membership,
    Test2,
    JwtRefreshToken,
    PasswordCredentials,
    PasswordResetToken,
    Company,
    MailingList,
    MailingListSubscriber,
    MailingListSubscriptionConfirmationToken,
    Log,
    Change,
    ChangeSet,
    Invoice,
    NumberInvoices,
    InvoiceRecipientAbbreviation,
    OtpCredentials,
    TwoFactorFailureStreak,
    BackupEntity,
    BackupResourceEntity,
    Email,
    CronJobEntity,
    ThreadJobEntity,
    WebsocketChannel,
    WebsocketMessage,
    WebsocketMessageSequence,
    Event,
    EventSubscriberRun,
    EventSubscriberRegistration,
    Lease,
    HashStrategyEntity,
    EncryptionStrategyEntity,
    EncryptionKey,
    EncryptionRotationProgress,
    EncryptionRotationFailure,
    CacheInvalidation
];