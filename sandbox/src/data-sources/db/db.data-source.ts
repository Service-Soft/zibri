import { BaseDataSource, BaseEntity, DataSource, Newable, DataSourceOptions, MigrationEntity, JwtRefreshToken, JwtCredentials, PasswordResetToken, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken, Log, Change, ChangeSet, Invoice, NumberInvoices, Entity, OmitClass } from 'zibri';

import { Company, Test, User } from '../../models';

@Entity()
class Test2 extends OmitClass(MigrationEntity, ['ranAt']) {}

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
        NumberInvoices
    ];
}