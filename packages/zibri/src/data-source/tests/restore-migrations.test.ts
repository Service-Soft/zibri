import { InMemoryDataSource } from 'zibri-testing';

import { describeRestoreMigrations, RestoredWidget } from './restore-migrations.cases';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { DataSource } from '../decorators/data-source.decorator';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Migration } from '../migration/migration.model';
import { RepositoryClass } from '../repository/repository-class.type';

/**
 * The entities of the data source, the widget last - which the cases swap for another release of it.
 */
const entities: Newable<BaseEntity>[] = [MigrationEntity, RestoredWidget];

/**
 * Its migrations, which the cases swap for another release's.
 */
const migrations: Newable<Migration>[] = [];

/**
 * An in memory data source holding the widget and nothing of the framework's, whose own entities
 * the cases keep in a data source of their own.
 */
@DataSource()
class RestoredInMemoryDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = entities;
    override readonly repositories: RepositoryClass[] = [];
    override readonly migrations: Newable<Migration>[] = migrations;
}

describeRestoreMigrations('the in memory data source', { dataSourceClass: RestoredInMemoryDataSource, entities, migrations });