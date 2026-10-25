import { AuditEntry, BaseEntity, CacheInvalidation, Change, ChangeSet, CronJobEntity, Email, EncryptionKey, EncryptionRotationFailure, EncryptionRotationProgress, EncryptionStrategyEntity, Event, EventSubscriberRegistration, EventSubscriberRun, HashStrategyEntity, JwtRefreshToken, Lease, Log, MigrationEntity, Newable, OtpCredentials, PasswordCredentials, PasswordResetToken, ThreadJobEntity, TwoFactorFailureStreak, WebsocketChannel, WebsocketMessage, WebsocketMessageSequence } from 'zibri';

// not every entity of the framework: each one here is a table every test data source creates, so
// one only some suites need stays with those suites
/**
 * The entities of the framework a test data source declares on top of the ones a test names: those
 * every application needs, and those of password and JWT sign-in, one-time passwords, migrations,
 * change sets, caches and websockets.
 *
 * A feature beyond these lists its entities under Requirements on its page. Name them in the
 * `entities` of the test data source.
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
    AuditEntry,
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
    EncryptionStrategyEntity,
    EncryptionRotationProgress,
    EncryptionRotationFailure
];