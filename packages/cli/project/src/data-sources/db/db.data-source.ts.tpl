import { BaseEntity, DataSource, Migration, Newable, PostgresDataSource, PostgresOptions, PostgresPooler, RepositoryClass, SchemaManagement } from 'zibri';

import { entities } from './entities';
import { migrations } from './migrations';
import { repositories } from './repositories';
import { requireBooleanEnv, requireEnv, requirePortEnv } from '../../env';

@DataSource()
export class DbDataSource extends PostgresDataSource {
    // the framework alters the database to match these classes on every boot, which is what a
    // model that is still moving wants and the wrong thing once anything is stored: a renamed
    // property takes the old column and its contents with it. Switch to 'migrations' before
    // this application holds data anyone would miss. See the data source docs.
    schemaManagement: SchemaManagement = 'synchronize';
    // the database is reached directly. Behind a pooler in transaction mode, such as PgBouncer,
    // declare it together with where the server itself is. See the data source docs.
    readonly pooler: PostgresPooler = 'none';

    options: PostgresOptions = {
        host: requireEnv('DB_HOST'),
        port: requirePortEnv('DB_PORT'),
        username: requireEnv('DB_USERNAME'),
        password: requireEnv('DB_PASSWORD'),
        database: requireEnv('DB_DATABASE'),
        ssl: requireBooleanEnv('DB_SSL')
    };
    entities: Newable<BaseEntity>[] = entities;
    repositories: RepositoryClass[] = repositories;
    override migrations: Newable<Migration>[] = migrations;
}
