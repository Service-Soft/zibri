import { PostgresDataSource, PostgresOptions, BaseEntity, DataSource, Newable, MigrationEntity, JwtRefreshToken, JwtCredentials, PasswordResetToken, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken, Log, Change, ChangeSet, Entity, OmitClass, OtpCredentials, BackupResourceEntity, BackupEntity, Invoice, NumberInvoices, Email, CronJobEntity, ThreadJobEntity, WebsocketChannel, WebsocketMessage } from 'zibri';

import { Company, Test, User } from '../../models';

@Entity()
class Test2 extends OmitClass(MigrationEntity, ['ranAt']) {}

@DataSource()
export class DbDataSource extends PostgresDataSource {
    rootPw: string = 'password';
    rootUsername: string = 'postgres';

    options: PostgresOptions = {
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'password',
        database: 'db',
        synchronize: true
    };
    entities: Newable<BaseEntity>[] = [
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
        WebsocketMessage
    ];
}