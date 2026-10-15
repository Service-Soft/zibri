import { describeKeyReconciliation, PlainWidget } from './key-reconciliation.cases';
import { createTestDataSource } from '../../__testing__/test-server/create-test-data-source.function';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { BaseEntity } from '../../entity/base-entity.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { Newable } from '../../types/newable.type';
import { SemVerVersion } from '../../versioning/sem-ver.utilities';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Migration } from '../migration/migration.model';
import { Transaction } from '../transaction/transaction.model';

/**
 * The entities of the postgres data source, the widget last - which the cases swap for another
 * release of it.
 */
const postgresEntities: Newable<BaseEntity>[] = [MigrationEntity, PlainWidget];

/**
 * Its migrations, filled in below: the migration names the data source, which is built from them.
 */
const postgresMigrations: Newable<Migration>[] = [];

// managed by its migrations, since that is what the indexes and uniques are kept under: a schema
// that is synchronized has them made to match by the orm instead
const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: postgresEntities,
    schemaManagement: 'migrations',
    migrations: postgresMigrations
});

/**
 * Creates the widget's table, as the release the store is first started with declares it.
 */
@Injectable()
class CreateWidgetTableMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    constructor() {
        super(postgresDataSourceClass);
    }

    override async up(transaction: Transaction): Promise<void> {
        const widget: Newable<BaseEntity> | undefined = postgresEntities.at(-1);
        if (widget == undefined) {
            throw new InternalError('The data source holds no widget.');
        }
        await this.dataSource.createEntity({ entity: widget, properties: 'resolveFromEntity', transaction });
    }

    // eslint-disable-next-line typescript/require-await
    override async down(): Promise<void> {
        throw new InternalError('Nothing reverts the widget\'s table.');
    }
}
postgresMigrations.push(CreateWidgetTableMigration);

// a file per store rather than one for both: each case boots only the store it runs on, and a data
// source declared in the same file but left out of the application is refused as an orphan
describeKeyReconciliation('postgres', { dataSourceClass: postgresDataSourceClass, entities: postgresEntities });