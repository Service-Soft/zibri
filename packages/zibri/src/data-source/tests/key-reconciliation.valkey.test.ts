import { describeKeyReconciliation, PlainWidget } from './key-reconciliation.cases';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

/**
 * The entities of the valkey data source, the widget last - which the cases swap for another
 * release of it.
 */
const valKeyEntities: Newable<BaseEntity>[] = [MigrationEntity, PlainWidget];

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({ entities: valKeyEntities });

describeKeyReconciliation('valkey', { dataSourceClass: valKeyDataSourceClass, entities: valKeyEntities });