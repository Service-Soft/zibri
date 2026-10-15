import { InMemoryDataSource } from 'zibri-testing';

import { describeKeyReconciliation, PlainWidget } from './key-reconciliation.cases';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { DataSource } from '../decorators/data-source.decorator';
import { MigrationEntity } from '../migration/migration-entity.model';

/**
 * The entities of the data source, the widget last - which the cases swap for another release of it.
 */
const entities: Newable<BaseEntity>[] = [MigrationEntity, PlainWidget];

/**
 * An in memory data source holding the widget and nothing of the framework's, whose own entities
 * the cases keep in a data source of their own.
 */
@DataSource()
class ReconciledInMemoryDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = entities;
}

describeKeyReconciliation('the in memory data source', { dataSourceClass: ReconciledInMemoryDataSource, entities });