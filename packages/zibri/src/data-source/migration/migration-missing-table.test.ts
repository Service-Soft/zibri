import { describe, expect, it } from '@jest/globals';

import { MigrationEntity } from './migration-entity.model';
import { Migration } from './migration.model';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { SemVerVersion } from '../../utilities/sem-ver.utilities';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { Transaction } from '../transaction/transaction.model';

@Entity({ tenant: 'shared' })
class CreatedShelf extends BaseEntity {
    @Property.string()
    label!: string;
}

/**
 * An entity no migration creates. It declares no key and no property a search reads, so nothing the
 * boot builds touches its table.
 */
@Entity({ tenant: 'shared' })
class ForgottenCrate extends BaseEntity {
    @Property.number({ format: 'integer' })
    amount!: number;
}

@Injectable()
class CreateAllButOneMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    constructor() {
        super(getDataSourceClass());
    }

    override async up(transaction: Transaction): Promise<void> {
        // the migration table is the one the data source creates itself, before any migration runs
        for (const entity of [...defaultTestServerEntities.filter(e => e !== MigrationEntity), CreatedShelf]) {
            await this.dataSource.createEntity({ entity, properties: 'resolveFromEntity', transaction });
        }
    }

    // eslint-disable-next-line typescript/require-await
    override async down(): Promise<void> {
        throw new Error('Not needed for this test.');
    }
}

// each data source of this file is booted by one case alone, and a declared data source a boot leaves
// out refuses that boot unless it may be an orphan
const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, CreatedShelf, ForgottenCrate],
    repositories: defaultTestServerRepositories,
    schemaManagement: 'migrations',
    migrations: [CreateAllButOneMigration],
    allowOrphan: true
});

const withoutMigrationsClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories,
    schemaManagement: 'migrations',
    migrations: [],
    allowOrphan: true
});

/**
 * The data source the migration runs in. Read through a function, because the data source names the
 * migration and so is built after it.
 * @returns The data source.
 */
function getDataSourceClass(): Newable<PostgresDataSource> {
    return dataSourceClass;
}

describe('a data source whose migrations manage the schema', () => {
    // refused at boot, rather than found by whatever reads the table first: an index built on it at
    // boot, with postgres' "relation does not exist", or, for an entity declaring no key and nothing
    // searchable, the first request using it
    it('refuses to start when no migration created the table of an entity, naming the entity', async () => {
        await expect(startTestServer({ dataSources: [dataSourceClass] })).rejects.toThrow(/ForgottenCrate/);
    }, TestTimeouts.postgres.start);

    // with nothing synchronizing and nothing to migrate, no table is ever created, and the first query
    // is where anybody would find out. 'external' is what says an empty migration list is deliberate
    it('refuses to start when it declares no migration at all', async () => {
        await expect(startTestServer({ dataSources: [withoutMigrationsClass] })).rejects.toThrow(/no migrations/);
    }, TestTimeouts.postgres.start);
});