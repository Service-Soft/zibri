import { describeRestoreMigrations, RestoredWidget } from './restore-migrations.cases';
import { createTestDataSource } from '../../__testing__/test-server/create-test-data-source.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Migration } from '../migration/migration.model';

/**
 * The entities of the postgres data source, the widget last - which the cases swap for another
 * release of it.
 */
const postgresEntities: Newable<BaseEntity>[] = [MigrationEntity, RestoredWidget];

/**
 * Its migrations, which the cases swap for another release's.
 */
const postgresMigrations: Newable<Migration>[] = [];

// managed by its migrations, since that is the schema an older backup brings back
const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: postgresEntities,
    schemaManagement: 'migrations',
    migrations: postgresMigrations
});

// a file per store rather than one for all: each case boots only the store it runs on, and a data
// source declared in the same file but left out of the application is refused as an orphan
describeRestoreMigrations('postgres', { dataSourceClass: postgresDataSourceClass, entities: postgresEntities, migrations: postgresMigrations });