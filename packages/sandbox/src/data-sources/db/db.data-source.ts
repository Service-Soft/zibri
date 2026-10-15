import { BaseEntity, DataSource, Newable, OmitStrict, PostgresDataSource, PostgresOptions, SchemaManagement } from 'zibri';

import { entities } from './entities';
import { requireBooleanEnv, requireEnv } from '../../env';

@DataSource()
export class DbDataSource extends PostgresDataSource {
    rootPw: string = 'password';
    rootUsername: string = 'postgres';
    // the framework alters the database to match these classes on every boot, which is what a
    // model that is still moving wants and the wrong thing once anything is stored: a renamed
    // property takes the old column and its contents with it. Switch to 'migrations' before
    // this application holds data anyone would miss. See the data source docs.
    schemaManagement: SchemaManagement = 'synchronize';

    options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
        host: requireEnv('DB_HOST'),
        port: Number(requireEnv('DB_PORT')),
        username: requireEnv('DB_USERNAME'),
        password: requireEnv('DB_PASSWORD'),
        database: requireEnv('DB_DATABASE'),
        ssl: requireBooleanEnv('DB_SSL')
    };
    entities: Newable<BaseEntity>[] = entities;
}