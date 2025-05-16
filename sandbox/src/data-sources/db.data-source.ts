import { BaseDataSource, BaseEntity, DataSource, Newable, DataSourceOptions } from "zibri";
import { Test } from "../models/test.model";
import { User } from "../models/user.model";

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
        User
    ];
}