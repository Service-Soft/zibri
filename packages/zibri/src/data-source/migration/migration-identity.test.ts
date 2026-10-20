import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MigrationEntity } from './migration-entity.model.ts';
import { Migration } from './migration.model.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { Injectable } from '../../di/decorators/injectable.decorator.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';
import { SemVerVersion } from '../../versioning/sem-ver.utilities.ts';
import { PostgresDataSource, PostgresOptions } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { DataSource } from '../decorators/data-source.decorator.ts';
import { SchemaManagement } from '../models/schema-management.model.ts';
import { Repository } from '../repository/repository.ts';

/**
 * The version both migrations below belong to, because they ship in the same release.
 *
 * That is the ordinary case rather than an edge one: two schema changes going out together share the
 * version they went out in, and the version is what says which app versions the schema state belongs
 * to. What it cannot also be is which migration this is.
 */
const releaseVersion: SemVerVersion = '0.1.0';

/**
 * What each migration did, in the order it happened.
 *
 * The rows say whether a migration ran; only this says in which order, and reverting has to undo a
 * release in the reverse of the order it was applied in. It is what the migrations do rather than a
 * table of their own because migrations run before the schema is synchronized - which is right, in
 * that a database with no tables yet has nothing for a migration to migrate.
 */
const journal: string[] = [];

@Injectable()
class FirstChangeOfTheRelease extends Migration {
    version: SemVerVersion = releaseVersion;

    constructor() {
        super(MigrationIdentityDataSource);
    }

    // eslint-disable-next-line typescript/require-await
    override async up(): Promise<void> {
        journal.push('first up');
    }

    // eslint-disable-next-line typescript/require-await
    override async down(): Promise<void> {
        journal.push('first down');
    }
}

@Injectable()
class SecondChangeOfTheRelease extends Migration {
    version: SemVerVersion = releaseVersion;

    constructor() {
        super(MigrationIdentityDataSource);
    }

    // eslint-disable-next-line typescript/require-await
    override async up(): Promise<void> {
        journal.push('second up');
    }

    // eslint-disable-next-line typescript/require-await
    override async down(): Promise<void> {
        journal.push('second down');
    }
}

// declared before the migrations it lists, so that they can name it back: a class referring forward
// to another class is resolved when one of them is constructed, which is long after this module has
// finished evaluating
@DataSource()
class MigrationIdentityDataSource extends PostgresDataSource {
    override options: OmitStrict<PostgresOptions, 'type'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };
    entities: Newable<BaseEntity>[] = defaultTestServerEntities;
    override migrations: Newable<Migration>[] = [FirstChangeOfTheRelease, SecondChangeOfTheRelease];
    // the framework entities still need their tables; the two migrations below are what this asserts
    schemaManagement: SchemaManagement = 'synchronize';
}

describe('two migrations shipping in one release', () => {
    let server: StartedTestServer;
    let migrationRepository: Repository<MigrationEntity>;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [MigrationIdentityDataSource] });
        migrationRepository = inject(repositoryTokenFor(MigrationEntity));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('runs both of them', () => {
        // applied-ness used to be "some record carries this version", so the second migration was
        // treated as applied the moment the first recorded itself. It never ran, and nothing said so
        expect(journal).toEqual(['first up', 'second up']);
    });

    it('records each of them under its own identity', async () => {
        const records: MigrationEntity[] = await migrationRepository.findAll();

        expect(records.map(r => r.name).sort()).toEqual(['FirstChangeOfTheRelease', 'SecondChangeOfTheRelease']);
        // the version says which release the schema state belongs to, and both belong to the same
        // one - so it is the thing that cannot also identify them, and cannot be unique either
        expect(records.every(r => r.version === releaseVersion)).toBe(true);
    });

    it('runs neither of them a second time', async () => {
        const before: string[] = [...journal];

        await inject(MigrationIdentityDataSource).runMigrations();

        expect(journal).toEqual(before);
    });

    it('leaves the other one recorded when one is reverted', async () => {
        await inject(SecondChangeOfTheRelease).runDown();

        const names: string[] = (await migrationRepository.findAll()).map(r => r.name);
        // deleting by version took both records with it, so reverting one change of a release told
        // the database that none of it had ever been applied
        expect(names).toEqual(['FirstChangeOfTheRelease']);

        // put it back, so that reverting the whole release below starts from a full one
        await inject(SecondChangeOfTheRelease).runUp();
    });

    it('reverts a release in the reverse of the order it was applied in', async () => {
        const before: number = journal.length;

        await inject(MigrationIdentityDataSource).revertMigrationsAfter('0.0.9');

        // a later change of a release may build on an earlier one, so undoing them in the order they
        // were applied takes the ground out from under its own next step. Sorting by version cannot
        // say which came first here, because they share one
        expect(journal.slice(before)).toEqual(['second down', 'first down']);
        expect(await migrationRepository.findAll()).toEqual([]);
    });
});