import { BaseDataSource, BaseEntity, DataSource, Newable, DataSourceOptions } from "zibri";
import { Company, Test, User } from "../models";

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
        Test,
        User,
        Company
    ];
}