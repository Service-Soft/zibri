import { BaseEntity, CacheInvalidation, Change, ChangeSet, CronJobEntity, Email, EncryptionKey, EncryptionStrategyEntity, Event, EventSubscriberRegistration, EventSubscriberRun, HashStrategyEntity, JwtRefreshToken, Lease, Log, MigrationEntity, Newable, OtpCredentials, PasswordCredentials, PasswordResetToken, ThreadJobEntity, TwoFactorFailureStreak, WebsocketChannel, WebsocketMessage, WebsocketMessageSequence } from 'zibri';

/**
 * Every entity the framework itself stores something in.
 *
 * A data source has to declare all of them or the subsystem behind the missing one fails at the
 * first write rather than at boot - and which subsystem keeps rows is not something an application
 * developer should have to know. Listed here so a data source can be built from this plus whatever
 * the application declares.
 */
export const zibriFrameworkEntities: Newable<BaseEntity>[] = [
    Change,
    ChangeSet,
    MigrationEntity,
    CronJobEntity,
    Lease,
    CacheInvalidation,
    Email,
    ThreadJobEntity,
    WebsocketChannel,
    WebsocketMessage,
    WebsocketMessageSequence,
    Log,
    PasswordResetToken,
    JwtRefreshToken,
    PasswordCredentials,
    OtpCredentials,
    TwoFactorFailureStreak,
    Event,
    EventSubscriberRun,
    EventSubscriberRegistration,
    HashStrategyEntity,
    EncryptionKey,
    EncryptionStrategyEntity
];