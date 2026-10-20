import { defaultClusterTestEntities, StartTestServerOptions } from 'zibri-testing';

import { PostgresDataSource, PostgresOptions } from '../../../data-source/data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { DataSource } from '../../../data-source/decorators/data-source.decorator.ts';
import { Migration } from '../../../data-source/migration/migration.model.ts';
import { SchemaManagement } from '../../../data-source/models/schema-management.model.ts';
import { Injectable } from '../../../di/decorators/injectable.decorator.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Newable } from '../../../types/newable.type.ts';
import { OmitStrict } from '../../../types/omit-strict.type.ts';
import { SemVerVersion } from '../../../versioning/sem-ver.utilities.ts';

/**
 * What every instance of the migration cluster boots with.
 *
 * The data source is declared here rather than taken from the defaults, because the whole point is
 * that it carries a migration. Like every instance options module this is imported by the parent as
 * well, so nothing at the top level may assume it is running inside an instance.
 */

/**
 * A migration that does nothing except record that it ran.
 *
 * Deliberately no DDL. A migration that created a table would have the losing instances fail on
 * "table already exists", which is a different symptom of the same race and would make it
 * ambiguous which one the test caught. This one can only fail for one reason: two instances both
 * decided the migration still needed running.
 */
@Injectable()
class ClusterMigration extends Migration {
    readonly version: SemVerVersion = '1.0.0';

    constructor() {
        // referenced before it is declared on purpose: this runs at construction, long after the
        // module finished evaluating, and declaring the data source first would put the migration
        // it carries below it instead
        super(MigrationDataSource);
    }

    protected async up(): Promise<void> {
        // nothing. runUp() writes the MigrationEntity row, and that row is the observation.
    }

    protected async down(): Promise<void> {
        // nothing to undo
    }
}

/**
 * The data source every instance connects to, carrying the migration above.
 */
@DataSource()
class MigrationDataSource extends PostgresDataSource {
    override options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };
    entities: Newable<BaseEntity>[] = defaultClusterTestEntities;
    override readonly migrations: Newable<Migration>[] = [ClusterMigration];
    // both halves race here, which is the point of this scenario: the original run failed on two
    // instances issuing the same CREATE TABLE, with the migration race still latent underneath it
    schemaManagement: SchemaManagement = 'synchronize';
}

const options: StartTestServerOptions = {
    dataSources: [MigrationDataSource]
};

export default options;