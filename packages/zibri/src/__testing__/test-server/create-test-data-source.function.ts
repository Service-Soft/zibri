import { Logger as TypeOrmLogger } from 'typeorm';
import { RoundTripCounter } from 'zibri-testing';

import { OtpCredentials } from '../../auth/2fa/methods/otp/otp-credentials.model';
import { TwoFactorFailureStreak } from '../../auth/2fa/two-factor-failure-streak.model';
import { PasswordCredentials } from '../../auth/authenticators/password/password-credentials.model';
import { EncryptionKey } from '../../auth/encryption/encryption-key.model';
import { EncryptionRotationFailure } from '../../auth/encryption/encryption-rotation-failure.model';
import { EncryptionRotationProgress } from '../../auth/encryption/encryption-rotation-progress.model';
import { EncryptionStrategyEntity } from '../../auth/encryption/strategies/encryption-strategy-entity.model';
import { HashStrategyEntity } from '../../auth/hash/strategies/hash-strategy-entity.model';
import { PasswordResetToken } from '../../auth/models/password-reset-token.model';
import { JwtRefreshToken } from '../../auth/strategies/jwt/jwt-refresh-token.model';
import { CacheInvalidation } from '../../caching/cache-invalidation.model';
import { ChangeSet } from '../../change-sets/models/change-set.model';
import { Change } from '../../change-sets/models/change.model';
import { CronJobEntity } from '../../cron/cron-job-entity.model';
import { PostgresDataSource, PostgresOptions } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { MigrationEntity } from '../../data-source/migration/migration-entity.model';
import { Migration } from '../../data-source/migration/migration.model';
import { SchemaManagement } from '../../data-source/models/schema-management.model';
import { Email } from '../../email/models/email.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { EventSubscriberRegistration } from '../../event/event-subscriber-registration.model';
import { EventSubscriberRun } from '../../event/event-subscriber-run.model';
import { Event } from '../../event/event.model';
import { Lease } from '../../leases/lease.model';
import { Log } from '../../logging/log.model';
import { ThreadJobEntity } from '../../multithreading/models/thread-job-entity.model';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { WebsocketChannel } from '../../websocket/models/websocket-channel.model';
import { WebsocketMessageSequence } from '../../websocket/models/websocket-message-sequence.model';
import { WebsocketMessage } from '../../websocket/models/websocket-message.model';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { TestMembership } from '../mocks/entities/test-membership.entity';

export type CreateTestDataSourceOptions = {
    entities?: Newable<BaseEntity>[],
    host?: string,
    username?: string,
    password?: string,
    database?: string,
    /**
     * Whether the built class may exist without an application using it.
     *
     * Needed only by a suite that calls this more than once and hands each application just one of
     * the results - the others are then declared and never deployed. Left false everywhere else, so
     * a data source a test meant to boot and forgot to pass still fails loudly.
     */
    allowOrphan?: boolean,
    /**
     * How many connections the data source may hold at once.
     *
     * Only a suite that is about the pool itself sets this. Left at the framework default everywhere
     * else, because a test that quietly runs on a pool of its own is not testing what ships.
     */
    poolSize?: number,
    /**
     * How long acquiring a connection may wait before it gives up.
     *
     * Set alongside a small `poolSize` so a pool that has nothing left to hand out reports that,
     * rather than leaving the caller waiting for a connection that is not coming.
     */
    connectionTimeoutInMs?: number,
    /**
     * Records every statement the data source sends, `BEGIN` and `COMMIT` included.
     *
     * Only a suite measuring what a call costs sets this, on a data source holding nothing but the
     * entities it measures, so that no service of the application adds statements of its own.
     */
    roundTrips?: RoundTripCounter,
    /**
     * Who manages the schema. Synchronizing when it is not given, which is the one shape a suite
     * shipping no migrations is right with.
     */
    schemaManagement?: SchemaManagement,
    /**
     * The migrations of the data source, for a suite whose migrations manage the schema.
     */
    migrations?: Newable<Migration>[]
};

export const defaultTestServerEntities: Newable<BaseEntity>[] = [
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
    JwtUser,
    TestMembership,
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

export function createTestDataSource({
    entities = defaultTestServerEntities,
    host = 'localhost',
    username = 'postgres',
    password = 'password',
    database = 'db',
    allowOrphan = false,
    poolSize,
    connectionTimeoutInMs,
    roundTrips,
    schemaManagement = 'synchronize',
    migrations = []
}: CreateTestDataSourceOptions = {}): Newable<PostgresDataSource & {
    /** The connection options of the data source. */
    options: OmitStrict<PostgresOptions, 'type' | 'entities'>,
    /** The entities of the data source. */
    entities: Newable<BaseEntity>[],
    /** Who manages the schema. Named here so a class extending this one counts as concrete. */
    schemaManagement: SchemaManagement
}> {

    @DataSource({ allowOrphan })
    class DbDataSource extends PostgresDataSource {
        override options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
            host,
            username,
            password,
            database,
            // the container serves no tls
            ssl: false,
            // spread rather than assigned, because an explicit undefined would take the framework
            // default away instead of leaving it in place
            ...poolSize != undefined ? { poolSize } : {},
            ...connectionTimeoutInMs != undefined ? { extra: { connectionTimeoutMillis: connectionTimeoutInMs } } : {},
            ...roundTrips != undefined ? { logging: true, logger: countingLogger(roundTrips) } : {}
        };
        entities: Newable<BaseEntity>[] = entities;
        override migrations: Newable<Migration>[] = migrations;
        // a suite that ships no migrations and needs tables synchronizes, which is the one
        // deployment shape that is actually right for. It used to be implicit, which is the finding
        schemaManagement: SchemaManagement = schemaManagement;
    }

    return DbDataSource;
}

/**
 * A typeorm logger that records each statement and prints nothing.
 * @param roundTrips - Where the statements are recorded.
 * @returns The logger.
 */
function countingLogger(roundTrips: RoundTripCounter): TypeOrmLogger {
    return {
        // typeorm logs a statement as it sends it, so a statement that fails is counted as well -
        // it was a round trip all the same
        logQuery: (query: string) => roundTrips.record(query),
        logQueryError: () => {},
        logQuerySlow: () => {},
        logSchemaBuild: () => {},
        logMigration: () => {},
        log: () => {}
    };
}