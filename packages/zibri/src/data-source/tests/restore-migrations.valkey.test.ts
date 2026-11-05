import { describeRestoreMigrations, RestoredWidget } from './restore-migrations.cases';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Migration } from '../migration/migration.model';

/**
 * The entities of the valkey data source, the widget last - which the cases swap for another
 * release of it.
 */
const valKeyEntities: Newable<BaseEntity>[] = [MigrationEntity, RestoredWidget];

/**
 * Its migrations, which the cases swap for another release's.
 */
const valKeyMigrations: Newable<Migration>[] = [];

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({ entities: valKeyEntities, migrations: valKeyMigrations });

describeRestoreMigrations('valkey', { dataSourceClass: valKeyDataSourceClass, entities: valKeyEntities, migrations: valKeyMigrations });