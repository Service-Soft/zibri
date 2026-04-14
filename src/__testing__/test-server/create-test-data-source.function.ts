import { OtpCredentials } from '../../auth/2fa/methods/otp/otp-credentials.model';
import { PasswordResetToken } from '../../auth/models/password-reset-token.model';
import { JwtCredentials } from '../../auth/strategies/jwt/jwt-credentials.model';
import { JwtRefreshToken } from '../../auth/strategies/jwt/jwt-refresh-token.model';
import { ChangeSet } from '../../change-sets/models/change-set.model';
import { Change } from '../../change-sets/models/change.model';
import { CronJobEntity } from '../../cron/cron-job-entity.model';
import { PostgresDataSource, PostgresOptions } from '../../data-source/data-sources/postgres-data-source.model';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { MigrationEntity } from '../../data-source/migration/migration-entity.model';
import { Email } from '../../email/models/email.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { EventSubscriberRun } from '../../event/event-subscriber-run.model';
import { Event } from '../../event/event.model';
import { Log } from '../../logging/log.model';
import { ThreadJobEntity } from '../../multithreading/models/thread-job-entity.model';
import { Newable } from '../../types/newable.type';
import { WebsocketChannel } from '../../websocket/models/websocket-channel.model';
import { WebsocketMessage } from '../../websocket/models/websocket-message.model';
import { JwtUser } from '../mocks/entities/jwt-user.entity';

export type CreateTestDataSourceOptions = {
    entities?: Newable<BaseEntity>[],
    host?: string,
    username?: string,
    password?: string,
    database?: string
};

export const defaultTestServerEntities: Newable<BaseEntity>[] = [
    Change,
    ChangeSet,
    MigrationEntity,
    CronJobEntity,
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
    EventSubscriberRun
];

export function createTestDataSource({
    entities = defaultTestServerEntities,
    host = 'localhost',
    username = 'postgres',
    password = 'password',
    database = 'db'
}: CreateTestDataSourceOptions = {}): Newable<PostgresDataSource> {

    @DataSource()
    class DbDataSource extends PostgresDataSource {
        options: PostgresOptions = {
            host,
            username,
            password,
            database,
            synchronize: true
        };
        entities: Newable<BaseEntity>[] = entities;
    }

    return DbDataSource;
}