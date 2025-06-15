import { BaseDataSource, BaseEntity, DataSource, Newable, DataSourceOptions, MigrationEntity, RefreshToken, JwtCredentials } from 'zibri';

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
        RefreshToken,
        JwtCredentials,
        Company
    ];
}