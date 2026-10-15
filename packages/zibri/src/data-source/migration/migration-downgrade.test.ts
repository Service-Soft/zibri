import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { MigrationEntity } from './migration-entity.model';
import { Migration } from './migration.model';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { SemVerVersion } from '../../versioning/sem-ver.utilities';
import { PostgresDataSource, PostgresOptions } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { DataSource } from '../decorators/data-source.decorator';
import { SchemaManagement } from '../models/schema-management.model';
import { Repository } from '../repository/repository';

/**
 * What the migration below did, in the order it happened.
 *
 * The finding is about a `down` that ran without anybody asking for it, so what has to be observable
 * is whether it ran - the row alone cannot say that, because the refusal leaves no application to read
 * it back with.
 */
const journal: string[] = [];

@DataSource()
class MigrationDowngradeDataSource extends PostgresDataSource {
    override options: OmitStrict<PostgresOptions, 'type'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };
    entities: Newable<BaseEntity>[] = defaultTestServerEntities;
    override migrations: Newable<Migration>[] = [NewerReleaseMigration];
    schemaManagement: SchemaManagement = 'synchronize';
}

// carried by this build but belonging to a release after it, so booting at 1.0.0 skips it. Having
// its `down` right here is the strongest form of the case: the application could revert it and must not
@Injectable()
class NewerReleaseMigration extends Migration {
    version: SemVerVersion = '2.0.0';

    constructor() {
        super(MigrationDowngradeDataSource);
    }

    // eslint-disable-next-line typescript/require-await
    override async up(): Promise<void> {
        journal.push('up');
    }

    // eslint-disable-next-line typescript/require-await
    override async down(): Promise<void> {
        journal.push('down');
    }
}

describe('an older instance starting against a newer schema', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [MigrationDowngradeDataSource] });
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    // one case, and it replaces the running application with one that refuses to start - nothing
    // after it would be looking at the server started above
    it('refuses to start rather than reverting what the newer instances applied', async () => {
        // what a 2.0.0 instance leaves behind: its own migration, and one this build never carried,
        // which is what a rollback to an older build looks like
        await inject(NewerReleaseMigration).runUp();
        const migrationRepository: Repository<MigrationEntity> = inject(repositoryTokenFor(MigrationEntity));
        await migrationRepository.create({ name: 'NotInThisBuildMigration', version: '2.1.0', ranAt: new Date() });

        const restart: Promise<void> = server.reInit();

        await expect(restart).rejects.toThrow('refuses to start');
        await expect(restart).rejects.toThrow('"NewerReleaseMigration" (2.0.0)');
        await expect(restart).rejects.toThrow('"NotInThisBuildMigration" (2.1.0)');
        // any migration above the app version used to be reverted at boot, so an old pod restarting
        // in the middle of a rolling deploy took the schema away from the new pods serving on it
        expect(journal).toEqual(['up']);
    }, 30000);
});