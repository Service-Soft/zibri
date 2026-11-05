import { AuditCheckpoint, AuditEntry, BaseEntity, BackupEntity, BackupResourceEntity, CacheInvalidation, ChainAnchor, Change, ChangeSet, CronJobEntity, Email, EncryptionKey, EncryptionRotationFailure, EncryptionRotationProgress, EncryptionStrategyEntity, Event, EventSubscriberRegistration, EventSubscriberRun, HashStrategyEntity, JwtRefreshToken, Lease, Log, LoginTicket, {{#mailingList}}MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken, {{/mailingList}}MigrationEntity, Newable, OtpCredentials, PasswordCredentials, PasswordResetToken, SigningKey, ThreadJobEntity, TwoFactorFailureStreak, WebsocketChannel, WebsocketMessage, WebsocketMessageSequence } from 'zibri';

import { Membership, Role, Tenant, User } from '../../models';

/**
 * Everything this application stores.
 *
 * Its own on top of the ones the framework and its plugins keep rows in. Declared here rather than
 * on the data source so that a test can put the same entities into a data source of its own without
 * the list drifting from the one production uses.
 */
export const entities: Newable<BaseEntity>[] = [
    MigrationEntity,
    User,
    Membership,
    Role,
    JwtRefreshToken,
    PasswordCredentials,
    PasswordResetToken,
    Tenant,
{{#mailingList}}
    MailingList,
    MailingListSubscriber,
    MailingListSubscriptionConfirmationToken,
{{/mailingList}}
    Log,
    AuditEntry,
    AuditCheckpoint,
    Change,
    ChangeSet,
    OtpCredentials,
    TwoFactorFailureStreak,
    LoginTicket,
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
    SigningKey,
    ChainAnchor,
    CacheInvalidation
];
