import { defaultClusterTestEntities, StartTestServerOptions } from 'zibri-testing';

import { PostgresDataSource, PostgresOptions } from '../../../data-source/data-sources/postgres/postgres-data-source.model';
import { PostgresPooler } from '../../../data-source/data-sources/postgres/postgres-pooler.model';
import { DataSource } from '../../../data-source/decorators/data-source.decorator';
import { Migration } from '../../../data-source/migration/migration.model';
import { SchemaManagement } from '../../../data-source/models/schema-management.model';
import { RepositoryClass } from '../../../data-source/repository/repository-class.type';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Newable } from '../../../types/newable.type';
import { SemVerVersion } from '../../../utilities/sem-ver.utilities';

/**
 * What every instance of the transaction pooler cluster boots with: the migration scenario of
 * ./migrations.instance-options.ts, behind PgBouncer in transaction mode, which the harness starts in
 * front of the server. Imported by the parent as well, so nothing at the top level may assume it is
 * running inside an instance.
 */

/**
 * A migration that does nothing except record that it ran, so it can only fail for one reason: two
 * instances both decided it still needed running.
 */
@Injectable()
class PooledClusterMigration extends Migration {
    readonly version: SemVerVersion = '1.0.0';

    constructor() {
        // referenced before it is declared on purpose: this runs at construction, long after the
        // module finished evaluating
        super(PooledMigrationDataSource);
    }

    protected async up(): Promise<void> {
        // nothing. runUp() writes the MigrationEntity row, and that row is the observation.
    }

    protected async down(): Promise<void> {
        // nothing to undo
    }
}

/**
 * The data source every instance connects to through the pooler, carrying the migration above.
 */
@DataSource()
class PooledMigrationDataSource extends PostgresDataSource {
    override options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };
    entities: Newable<BaseEntity>[] = defaultClusterTestEntities;
    readonly repositories: RepositoryClass[] = [];
    override readonly migrations: Newable<Migration>[] = [PooledClusterMigration];
    schemaManagement: SchemaManagement = 'synchronize';
    readonly pooler: PostgresPooler = { mode: 'transaction', direct: { host: 'localhost' } };
}

const options: StartTestServerOptions = {
    dataSources: [PooledMigrationDataSource]
};

export default options;