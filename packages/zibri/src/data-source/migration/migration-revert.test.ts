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
import { RepositoryClass } from '../repository/repository-class.type';

/**
 * What each migration did, in the order it happened.
 */
const journal: string[] = [];

/**
 * The migrations of the build that runs, which the cases swap for an earlier commit's.
 */
const carriedMigrations: Newable<Migration>[] = [];

@DataSource()
class RevertedDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = defaultTestServerEntities;
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
    override readonly migrations: Newable<Migration>[] = carriedMigrations;
}

const dataSourceClass: Newable<InMemoryDataSource> = RevertedDataSource;

/**
 * A migration that writes what it does into the journal, under the name of its class.
 */
abstract class JournalingMigration extends Migration {
    // every commit of the release shares it
    version: SemVerVersion = '1.0.0';

    constructor() {
        super(dataSourceClass);
    }

    // eslint-disable-next-line typescript/require-await
    override async up(): Promise<void> {
        journal.push(`${this.constructor.name} up`);
    }

    // eslint-disable-next-line typescript/require-await
    override async down(): Promise<void> {
        journal.push(`${this.constructor.name} down`);
    }
}

// each with a constructor of its own, since the container reads what to inject off the class it builds
@Injectable()
class OfTheEarlierCommitMigration extends JournalingMigration {

    constructor() {
        super();
    }
}

@Injectable()
class FirstOfTheLaterCommitMigration extends JournalingMigration {

    constructor() {
        super();
    }
}

@Injectable()
class SecondOfTheLaterCommitMigration extends JournalingMigration {

    constructor() {
        super();
    }
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    carriedMigrations.push(OfTheEarlierCommitMigration, FirstOfTheLaterCommitMigration, SecondOfTheLaterCommitMigration);
    server = await startTestServer({ dataSources: [dataSourceClass] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

// part of evaluation round 2, 02 §S14: reverting went by version alone, which every commit of a
// release shares, so going back to an earlier commit of the same release had no way to say how far
describe('reverting the migrations applied after one of them', () => {
    it('refuses a migration the database has not recorded', async () => {
        await expect(inject(dataSourceClass).revertMigrationsAfter({ migrationName: 'NeverRanMigration' }))
            .rejects.toThrow('the database has recorded no migration of that name');
    });

    it('reverts every one applied after it, newest first, and keeps it', async () => {
        const before: number = journal.length;

        await inject(dataSourceClass).revertMigrationsAfter({ migrationName: OfTheEarlierCommitMigration.name });

        expect(journal.slice(before)).toEqual([`${SecondOfTheLaterCommitMigration.name} down`, `${FirstOfTheLaterCommitMigration.name} down`]);
        const recorded: MigrationEntity[] = await inject(repositoryTokenFor(MigrationEntity, dataSourceClass)).findAll();
        expect(recorded.map(m => m.name)).toEqual([OfTheEarlierCommitMigration.name]);
    });

    it('lets the build of the earlier commit start afterwards', async () => {
        if (server == undefined) {
            throw new Error('the server did not start');
        }
        carriedMigrations.splice(1);

        await expect(server.reInit()).resolves.toBeUndefined();
    }, TestTimeouts.inMemory.restart);
});