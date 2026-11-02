import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource, TestCommandRun } from 'zibri-testing';

import { MigrationGenerationResponse } from './migration-generation.model';
import { Migration } from './migration.model';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Injectable } from '../../di/decorators/injectable.decorator';
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
class CommandedDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = defaultTestServerEntities;
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
    override readonly migrations: Newable<Migration>[] = carriedMigrations;
}

const dataSourceClass: Newable<InMemoryDataSource> = CommandedDataSource;

/**
 * A migration that writes what it does into the journal, under the name of its class.
 */
abstract class JournalingMigration extends Migration {
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
class CreateShelfMigration extends JournalingMigration {

    constructor() {
        super();
    }
}

@Injectable()
class AddShelfColorMigration extends JournalingMigration {

    constructor() {
        super();
    }
}

let server: StartedTestServer | undefined;

/**
 * Whether a value is what an application answers `zi migrate create`.
 * @param value - The value, read from the file it was written into.
 * @returns True when it lists migrations, each with its data source and code.
 */
function isGenerationResponse(value: unknown): value is MigrationGenerationResponse {
    return typeof value === 'object' && value != undefined && 'migrations' in value && Array.isArray(value.migrations)
        && value.migrations.every((m: unknown) => typeof m === 'object' && m != undefined
            && 'dataSource' in m && typeof m.dataSource === 'string'
            && 'code' in m && typeof m.code === 'string');
}

/**
 * Hands over the started server.
 * @returns The server.
 * @throws When the server did not start.
 */
function getServer(): StartedTestServer {
    if (server == undefined) {
        throw new Error('the server did not start');
    }
    return server;
}

beforeAll(async () => {
    carriedMigrations.push(CreateShelfMigration, AddShelfColorMigration);
    server = await startTestServer({ dataSources: [dataSourceClass] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

// going back was a method to call from code of one's own, which
// a deployment - a bundle, without the framework's cli - had no way to run
describe('the migration commands of an application', () => {
    it('leave a process started without one to start the application', async () => {
        const run: TestCommandRun = await getServer().runCommand([]);

        expect(run.ran).toBe(false);
    }, TestTimeouts.inMemory.restart);

    it('refuse a migration command they do not know, naming the ones they do', async () => {
        // eslint-disable-next-line cspell/spellchecker
        await expect(getServer().runCommand(['migrate', 'dwon', CreateShelfMigration.name])).rejects.toThrow('migrate down <version | migration name>');
    }, TestTimeouts.inMemory.restart);

    it('list the applied migrations in the order they ran', async () => {
        const run: TestCommandRun = await getServer().runCommand(['migrate', 'list']);

        expect(run.ran).toBe(true);
        const listed: string[] = run.log.filter(line => line.includes('Migration'));
        expect(listed.map(line => line.trim().split(/\s+/)
            .slice(1))).toEqual([
            ['1.0.0', CreateShelfMigration.name],
            ['1.0.0', AddShelfColorMigration.name]
        ]);
    }, TestTimeouts.inMemory.restart);

    it('list them with the build of an earlier commit too, which refuses to start on them', async () => {
        carriedMigrations.splice(1);
        try {
            const run: TestCommandRun = await getServer().runCommand(['migrate', 'list']);

            expect(run.log.some(line => line.endsWith(`${AddShelfColorMigration.name} (not carried by this build)`))).toBe(true);
        }
        finally {
            carriedMigrations.push(AddShelfColorMigration);
        }
    }, TestTimeouts.inMemory.restart);

    it('revert every migration applied after the one named', async () => {
        const before: number = journal.length;

        const run: TestCommandRun = await getServer().runCommand(['migrate', 'down', CreateShelfMigration.name]);

        expect(run.ran).toBe(true);
        expect(journal.slice(before)).toEqual([`${AddShelfColorMigration.name} down`]);
    }, TestTimeouts.inMemory.restart);

    it('let the build of the earlier commit start afterwards', async () => {
        carriedMigrations.splice(1);

        await expect(getServer().reInit()).resolves.toBeUndefined();
    }, TestTimeouts.inMemory.restart);

    it('write the migration of what the entities declare, and nothing once its snapshot is committed', async () => {
        const requestFile: string = path.join(getServer().scratchPath, 'generate-request.json');
        const responseFile: string = path.join(getServer().scratchPath, 'generate-response.json');
        writeFileSync(requestFile, JSON.stringify({ dataSources: { [dataSourceClass.name]: { import: '../commanded.data-source' } } }));

        const run: TestCommandRun = await getServer().runCommand(['migrate', 'generate', requestFile, responseFile]);

        expect(run.ran).toBe(true);
        const response: unknown = JSON.parse(readFileSync(responseFile, 'utf8'));
        if (!isGenerationResponse(response)) {
            throw new Error('The application answered no migrations.');
        }
        const [migration] = response.migrations;
        expect(response.migrations.map(m => m.dataSource)).toStrictEqual([dataSourceClass.name]);
        expect(migration?.code).toContain('import { CommandedDataSource } from \'../commanded.data-source\';');
        expect(migration?.code).toContain('await this.dataSource.createEntity({');

        writeFileSync(requestFile, JSON.stringify({ dataSources: { [dataSourceClass.name]: { import: '../commanded.data-source', snapshot: migration?.snapshot } } }));
        await expect(getServer().runCommand(['migrate', 'generate', requestFile, responseFile])).rejects.toThrow('Nothing the entities declare changed');
    }, 2 * TestTimeouts.inMemory.restart);

    // a data source moving from synchronize to migrations had its tables already, and the first
    // generated migration created them again
    it('write the snapshot of a data source that has none in place of a migration, for a baseline', async () => {
        const requestFile: string = path.join(getServer().scratchPath, 'baseline-request.json');
        const responseFile: string = path.join(getServer().scratchPath, 'baseline-response.json');
        writeFileSync(requestFile, JSON.stringify({ baseline: true, dataSources: { [dataSourceClass.name]: { import: '../commanded.data-source' } } }));

        await getServer().runCommand(['migrate', 'generate', requestFile, responseFile]);

        const response: unknown = JSON.parse(readFileSync(responseFile, 'utf8'));
        if (!isGenerationResponse(response)) {
            throw new Error('The application answered no migrations.');
        }
        expect(response.migrations).toStrictEqual([]);
        const [baseline] = response.baselines ?? [];
        expect(baseline?.dataSource).toBe(dataSourceClass.name);

        // what the entities declare is the starting point now, so nothing changed since
        writeFileSync(requestFile, JSON.stringify({ dataSources: { [dataSourceClass.name]: { import: '../commanded.data-source', snapshot: baseline?.snapshot } } }));
        await expect(getServer().runCommand(['migrate', 'generate', requestFile, responseFile])).rejects.toThrow('Nothing the entities declare changed');
        writeFileSync(requestFile, JSON.stringify({ baseline: true, dataSources: { [dataSourceClass.name]: { import: '../commanded.data-source', snapshot: baseline?.snapshot } } }));
        await expect(getServer().runCommand(['migrate', 'generate', requestFile, responseFile])).rejects.toThrow('has a snapshot already');
    }, 3 * TestTimeouts.inMemory.restart);

    it('revert every migration of a newer version than the one named', async () => {
        const before: number = journal.length;

        await getServer().runCommand(['migrate', 'down', '0.9.0']);

        expect(journal.slice(before)).toEqual([`${CreateShelfMigration.name} down`]);
        expect((await getServer().runCommand(['migrate', 'list'])).log).toContain(`${dataSourceClass.name}: no migrations applied`);
    }, 2 * TestTimeouts.inMemory.restart);

    // a build from before the first migration, of the same release, had no migration to name and no
    // version older than the ones applied: its refusal could only say to revert "those migrations"
    it('revert every applied migration with --all, which a build that carries none of them names', async () => {
        carriedMigrations.splice(0, carriedMigrations.length, CreateShelfMigration, AddShelfColorMigration);
        await getServer().reInit();
        carriedMigrations.splice(0);
        await expect(getServer().reInit()).rejects.toThrow('run "migrate down --all" with the newer build');
        carriedMigrations.push(CreateShelfMigration, AddShelfColorMigration);
        const before: number = journal.length;

        const run: TestCommandRun = await getServer().runCommand(['migrate', 'down', '--all']);

        expect(run.ran).toBe(true);
        expect(journal.slice(before)).toEqual([`${AddShelfColorMigration.name} down`, `${CreateShelfMigration.name} down`]);
        carriedMigrations.splice(0);
        await expect(getServer().reInit()).resolves.toBeUndefined();
    }, 4 * TestTimeouts.inMemory.restart);
});