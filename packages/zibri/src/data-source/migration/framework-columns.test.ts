import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { MigratedEntityUtilities } from './migrated-entity.utilities';
import { MigrationEntity } from './migration-entity.model';
import { Migration } from './migration.model';
import { TestTimeouts } from '../../__testing__/constants';
import { queryPostgres } from '../../__testing__/query-postgres.function';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { BackupEntity } from '../../backup/backup-entity.model';
import { BackupResourceEntity } from '../../backup/backup-resource-entity.model';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { inject } from '../../di/inject.function';
import { GlobalRegistry } from '../../global/global-registry';
import { Log } from '../../logging/log.model';
import { Newable } from '../../types/newable.type';
import { SemVerVersion } from '../../utilities/sem-ver.utilities';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { Transaction } from '../transaction/transaction.model';

const LOGS: string = MigratedEntityUtilities.resolveTableName(Log);
const RESOURCES: string = MigratedEntityUtilities.resolveTableName(BackupResourceEntity);

/**
 * The migrations of an application of 3.0: every table as 3.0 stored it, without the columns the framework added
 * since, and a log written before the upgrade.
 */
@Injectable()
class SchemaOfThreeMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    constructor() {
        super(getDataSourceClass());
    }

    override async up(transaction: Transaction): Promise<void> {
        // the migration table is the one the data source creates itself, before any migration runs
        for (const entity of [...defaultTestServerEntities.filter(e => e !== MigrationEntity), BackupEntity, BackupResourceEntity]) {
            await this.dataSource.createEntity({ entity, properties: 'resolveFromEntity', transaction });
        }
        await this.dataSource.removePropertyFromEntity({ entity: Log, propertyKey: 'application', transaction });
        for (const propertyKey of ['stagedSize', 'baseBackupId', 'readCursor']) {
            await this.dataSource.removePropertyFromEntity({ entity: BackupResourceEntity, propertyKey, transaction });
        }
        const dataSource: PostgresDataSource = inject(getDataSourceClass());
        await queryPostgres(
            dataSource,
            `INSERT INTO "${LOGS}" ("level", "message", "context", "createdAt", "cleanupAt") VALUES (2, 'written by 3.0', '{}', now(), now() + interval '1 day')`,
            [],
            transaction
        );
    }

    // eslint-disable-next-line typescript/require-await
    override async down(): Promise<void> {
        throw new Error('Not needed for this test.');
    }
}

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, BackupEntity, BackupResourceEntity],
    repositories: defaultTestServerRepositories,
    schemaManagement: 'migrations',
    migrations: [SchemaOfThreeMigration]
});

/**
 * The data source the migration runs in. Read through a function, because the data source names the
 * migration and so is built after it.
 * @returns The data source.
 */
function getDataSourceClass(): Newable<PostgresDataSource> {
    return dataSourceClass;
}

// a column the framework added to an entity of its own took a migration of every application managing its schema by
// migrations, which the upgrade from 3.0 did not tell it about
describe('a data source whose migrations manage the schema, migrated as 3.0 stored it', () => {
    let server: StartedTestServer | undefined;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
    }, TestTimeouts.postgres.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.postgres.shutdown);

    /**
     * The columns of a table, as postgres lists them.
     * @param table - The table.
     * @returns The name and the default of each.
     */
    async function findColumns(table: string): Promise<Record<string, unknown>[]> {
        return await queryPostgres(
            inject(dataSourceClass),
            'SELECT column_name AS "name", column_default AS "default" FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
            [table]
        );
    }

    it('adds the columns the framework added since, without a migration of the application', async () => {
        const logColumns: string[] = (await findColumns(LOGS)).map(c => String(c['name']));
        const resourceColumns: string[] = (await findColumns(RESOURCES)).map(c => String(c['name']));

        expect(logColumns).toContain('application');
        expect(resourceColumns).toEqual(expect.arrayContaining(['stagedSize', 'baseBackupId', 'readCursor']));
    });

    it('gives the logs stored before the name of the application, and leaves the column without a default', async () => {
        const rows: Record<string, unknown>[] = await queryPostgres(
            inject(dataSourceClass),
            `SELECT "application" FROM "${LOGS}" WHERE "message" = 'written by 3.0'`
        );
        const application: Record<string, unknown> | undefined = (await findColumns(LOGS)).find(c => c['name'] === 'application');

        expect(rows).toEqual([{ application: GlobalRegistry.getAppData('name') }]);
        expect(application?.['default']).toBeNull();
    });

    it('adds nothing on the next start, which finds the columns there', async () => {
        await server?.reInit();

        expect(server?.bootLog.join('\n')).not.toContain('adds what the framework added to its entities');
    }, TestTimeouts.postgres.start);
});