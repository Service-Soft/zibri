import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, RoundTripCounter } from 'zibri-testing';

import { BackupDataOptionsTestUtilities } from '../../../__testing__/backup/backup-data-options-test.utilities';
import { TestTimeouts } from '../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { inject } from '../../../di/inject.function';
import { Newable } from '../../../types/newable.type';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { Stamp } from '../../data-source-time.cases';
import { MigrationEntity } from '../../migration/migration-entity.model';
import { Repository } from '../../repository/repository';
import { ValKeyDataSource } from './val-key-data-source.model';

const roundTrips: RoundTripCounter = new RoundTripCounter();

// the framework's own entities in memory, so that no service of the application - a cron poll, a
// lease being renewed - sends anything through the counted client
const frameworkDataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Stamp],
    roundTrips
});

let server: StartedTestServer | undefined;
let dataSource: ValKeyDataSource;
let stamps: Repository<Stamp>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [frameworkDataSourceClass, valKeyDataSourceClass] });
    dataSource = inject(valKeyDataSourceClass);
    stamps = dataSource.getRepository(Stamp);
}, TestTimeouts.valKey.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.valKey.shutdown);

describe('a restore of a valkey backup', () => {
    it('restores its keys many to a request rather than one by one', async () => {
        const batch: string = UUIDUtilities.generate();
        await stamps.createAll(Array.from({ length: 1000 }, () => ({ batch, at: new Date() })));
        const lines: string[] = [];
        for await (const chunk of dataSource.createBackupData(undefined, BackupDataOptionsTestUtilities.resolve())) {
            lines.push(String(chunk));
        }

        roundTrips.reset();
        await dataSource.restoreBackup(Readable.from(lines));

        // what scales with the keys is the restoring and the rebuild after it, each a batch of keys a
        // request; a request per key is as many as there are lines
        expect(roundTrips.trips.length).toBeLessThan(lines.length / 10);
        expect((await stamps.findAll({ where: { batch } })).length).toBe(1000);
    }, 60000);
});