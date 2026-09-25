import { BaseEntity, BackupEntity, BackupResourceEntity, CacheInvalidation, Change, ChangeSet, CronJobEntity, Email, EncryptionKey, EncryptionStrategyEntity, Entity, Event, EventSubscriberRegistration, EventSubscriberRun, HashStrategyEntity, Invoice, JwtCredentials, JwtRefreshToken, Lease, Log, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken, MigrationEntity, Newable, NumberInvoices, OmitClass, OtpCredentials, PasswordResetToken, ThreadJobEntity, WebsocketChannel, WebsocketMessage } from 'zibri';

import { Company, Test, User } from '../../models';

@Entity()
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
    Test2,
    JwtRefreshToken,
    JwtCredentials,
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
    OtpCredentials,
    BackupEntity,
    BackupResourceEntity,
    Email,
    CronJobEntity,
    ThreadJobEntity,
    WebsocketChannel,
    WebsocketMessage,
    Event,
    EventSubscriberRun,
    EventSubscriberRegistration,
    Lease,
    HashStrategyEntity,
    EncryptionStrategyEntity,
    EncryptionKey,
    CacheInvalidation
];