import { BaseDataSource, BaseEntity, DataSource, Newable, DataSourceOptions, MigrationEntity, JwtRefreshToken, JwtCredentials, PasswordResetToken, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken, Log, Change, ChangeSet } from 'zibri';

import { Company, Test, User } from '../../models';

@DataSource()
export class DbDataSource extends BaseDataSource {
    options: DataSourceOptions = {
        type: 'postgres',
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
        JwtRefreshToken,
        JwtCredentials,
        PasswordResetToken,
        Company,
        MailingList,
        MailingListSubscriber,
        MailingListSubscriptionConfirmationToken,
        Log,
        Change,
        ChangeSet
    ];
}