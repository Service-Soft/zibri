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
import { MailingListSubscriber } from '../../email/mailing-list/models/mailing-list-subscriber.model';
import { MailingListSubscriptionConfirmationToken } from '../../email/mailing-list/models/mailing-list-subscription-confirmation-token.model';
import { MailingList } from '../../email/mailing-list/models/mailing-list.model';
import { Email } from '../../email/models/email.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Log } from '../../logging/log.model';
import { ThreadJobEntity } from '../../multithreading/models/thread-job-entity.model';
import { Payment } from '../../plugin/payment/models/payment.model';
import { Newable } from '../../types/newable.type';
import { WebsocketChannel } from '../../websocket/models/websocket-channel.model';
import { WebsocketMessage } from '../../websocket/models/websocket-message.model';
import { JwtUser } from '../mocks/entities/jwt-user.entity';

@DataSource()
export class DefaultTestServerDataSource extends PostgresDataSource {
    options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        synchronize: true
    };
    entities: Newable<BaseEntity>[] = [
        Change,
        ChangeSet,
        MigrationEntity,
        CronJobEntity,
        Email,
        MailingListSubscriptionConfirmationToken,
        ThreadJobEntity,
        WebsocketChannel,
        WebsocketMessage,
        Log,
        PasswordResetToken,
        JwtUser,
        JwtRefreshToken,
        JwtCredentials,
        OtpCredentials,
        MailingList,
        MailingListSubscriber,
        ThreadJobEntity,
        Payment
    ];
}