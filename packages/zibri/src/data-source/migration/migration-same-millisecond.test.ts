import { afterAll, describe, expect, it, jest } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

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
 * The moment every migration of the newer build runs at.
 */
const START: Date = new Date('2026-10-27T12:00:00.000Z');

/**
 * The migrations of the build that runs, which the case swaps for an older build's.
 */
const carriedMigrations: Newable<Migration>[] = [];

@DataSource()
class SameMillisecondDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = defaultTestServerEntities;
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
    override readonly migrations: Newable<Migration>[] = carriedMigrations;
}

const dataSourceClass: Newable<InMemoryDataSource> = SameMillisecondDataSource;

@Injectable()
class CarriedByBothMigration extends Migration {
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

@Injectable()
class FromALaterCommitMigration extends Migration {
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

let server: StartedTestServer | undefined;

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

// a build is ahead of the database by the migrations it does not
// carry that ran after its own, and two migrations applied within one millisecond were recorded as
// having run at the same moment - so the later one did not count as after
describe('an older build starting against migrations a newer one applied within one millisecond', () => {
    it('refuses to start, naming the one it does not carry', async () => {
        carriedMigrations.push(CarriedByBothMigration, FromALaterCommitMigration);
        // the clock alone stands still, so that both migrations run in the same millisecond
        jest.useFakeTimers({
            now: START,
            doNotFake: [
                'nextTick',
                'setImmediate',
                'clearImmediate',
                'setInterval',
                'clearInterval',
                'setTimeout',
                'clearTimeout',
                'queueMicrotask',
                'hrtime',
                'performance'
            ]
        });
        try {
            server = await startTestServer({ dataSources: [dataSourceClass] });
        }
        finally {
            jest.useRealTimers();
        }

        carriedMigrations.splice(1);
        const restart: Promise<void> = server.reInit();

        await expect(restart).rejects.toThrow('"FromALaterCommitMigration" (0.0.1)');
    }, TestTimeouts.inMemory.start + TestTimeouts.inMemory.restart);
});