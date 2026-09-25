import { OtpCredentials } from '../../auth/2fa/methods/otp/otp-credentials.model';
import { EncryptionKey } from '../../auth/encryption/encryption-key.model';
import { EncryptionStrategyEntity } from '../../auth/encryption/strategies/encryption-strategy-entity.model';
import { HashStrategyEntity } from '../../auth/hash/strategies/hash-strategy-entity.model';
import { PasswordResetToken } from '../../auth/models/password-reset-token.model';
import { JwtCredentials } from '../../auth/strategies/jwt/jwt-credentials.model';
import { JwtRefreshToken } from '../../auth/strategies/jwt/jwt-refresh-token.model';
import { CacheInvalidation } from '../../caching/cache-invalidation.model';
import { ChangeSet } from '../../change-sets/models/change-set.model';
import { Change } from '../../change-sets/models/change.model';
import { CronJobEntity } from '../../cron/cron-job-entity.model';
import { PostgresDataSource, PostgresOptions } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { MigrationEntity } from '../../data-source/migration/migration-entity.model';
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
import { WebsocketMessage } from '../../websocket/models/websocket-message.model';
import { JwtUser } from '../mocks/entities/jwt-user.entity';

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
    connectionTimeoutInMs?: number
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
    Log,
    PasswordResetToken,
    JwtUser,
    JwtRefreshToken,
    JwtCredentials,
    OtpCredentials,
    ThreadJobEntity,
    Event,
    EventSubscriberRun,
    EventSubscriberRegistration,
    HashStrategyEntity,
    EncryptionKey,
    EncryptionStrategyEntity
];

export function createTestDataSource({
    entities = defaultTestServerEntities,
    host = 'localhost',
    username = 'postgres',
    password = 'password',
    database = 'db',
    allowOrphan = false,
    poolSize,
    connectionTimeoutInMs
}: CreateTestDataSourceOptions = {}): Newable<PostgresDataSource & {
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
            // spread rather than assigned, because an explicit undefined would take the framework
            // default away instead of leaving it in place
            ...poolSize != undefined ? { poolSize } : {},
            ...connectionTimeoutInMs != undefined ? { extra: { connectionTimeoutMillis: connectionTimeoutInMs } } : {}
        };
        entities: Newable<BaseEntity>[] = entities;
        // the suite ships no migrations and needs tables, so it is the one deployment shape this is
        // actually right for. It used to be implicit, which is the finding
        schemaManagement: SchemaManagement = 'synchronize';
    }

    return DbDataSource;
}