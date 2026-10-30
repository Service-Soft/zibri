import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { MigrationEntity } from './migration-entity.model';
import { Migration } from './migration.model';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { SemVerVersion } from '../../utilities/sem-ver.utilities';
import { DataSource } from '../decorators/data-source.decorator';
import { Repository } from '../repository/repository';
import { RepositoryClass } from '../repository/repository-class.type';

/**
 * The data source, as the build under test carries it: one migration, of a version older than the app.
 */
@DataSource()
class CarriedMigrationsDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = defaultTestServerEntities;
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
    override readonly migrations: Newable<Migration>[] = [CarriedMigration];
}

const dataSourceClass: Newable<InMemoryDataSource> = CarriedMigrationsDataSource;

@Injectable()
class CarriedMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    constructor() {
        super(dataSourceClass);
    }

    override async up(): Promise<void> {
        // nothing to change, it only has to be recorded
    }

    override async down(): Promise<void> {
        // nothing to change back
    }
}

/**
 * Records a migration this build does not carry, as another build of the app would have.
 * @param name - The name of the migration.
 * @param ranAt - When it ran, measured against when this build's own migration did.
 */
async function recordMigrationOfAnotherBuild(name: string, ranAt: 'before' | 'after'): Promise<void> {
    const migrations: Repository<MigrationEntity> = inject(repositoryTokenFor(MigrationEntity, dataSourceClass));
    const [own] = await migrations.findAll({ where: { name: CarriedMigration.name } });
    if (own == undefined) {
        throw new Error('the migration of this build was not recorded');
    }
    const offsetInMs: number = ranAt === 'before' ? -1000 : 1000;
    // the version of the app itself, which a commit after this one still has until the next release
    await migrations.create({ name, version: '1.0.0', ranAt: new Date(own.ranAt.getTime() + offsetInMs) });
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

// part of evaluation round 2, 02 §S14: whether the database is ahead of a build was read off the
// versions alone, so going back to an earlier commit of the same release booted against a schema it
// did not know
describe('a build starting against a database that recorded migrations it does not carry', () => {
    it('starts when they ran before its own, as migrations taken out of the code base once they ran everywhere', async () => {
        if (server == undefined) {
            throw new Error('the server did not start');
        }
        await recordMigrationOfAnotherBuild('RemovedLongAgoMigration', 'before');

        await expect(server.reInit()).resolves.toBeUndefined();
    }, TestTimeouts.inMemory.restart);

    // last, since it leaves no application running
    it('refuses to start when they ran after its own, as those of a later commit of the same release', async () => {
        if (server == undefined) {
            throw new Error('the server did not start');
        }
        await recordMigrationOfAnotherBuild('FromALaterCommitMigration', 'after');

        const restart: Promise<void> = server.reInit();

        await expect(restart).rejects.toThrow('refuses to start');
        await expect(restart).rejects.toThrow('"FromALaterCommitMigration" (1.0.0)');
        await expect(restart).rejects.toThrow('run "migrate down CarriedMigration" with the newer build');
    }, TestTimeouts.inMemory.restart);
});