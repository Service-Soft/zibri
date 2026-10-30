import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, RoundTripCounter } from 'zibri-testing';

import { ValKeyDataSource } from './val-key-data-source.model';
import { TestTimeouts } from '../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { inject } from '../../../di/inject.function';
import { Newable } from '../../../types/newable.type';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { Stamp } from '../../data-source-time.cases';
import { MigrationEntity } from '../../migration/migration-entity.model';
import { dataSourceNow } from '../../models/data-source-now.function';
import { Repository } from '../../repository/repository';

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
let stamps: Repository<Stamp>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [frameworkDataSourceClass, valKeyDataSourceClass] });
    stamps = inject(valKeyDataSourceClass).getRepository(Stamp);
}, TestTimeouts.valKey.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.valKey.shutdown);

/**
 * Counts the round trips a call makes.
 * @param call - The call.
 * @returns How many it made.
 */
async function countRoundTrips(call: () => Promise<unknown>): Promise<number> {
    roundTrips.reset();
    await call();
    return roundTrips.trips.length;
}

// round 2's 02 §S21: valkey judges a filter in this process, so a call naming the time of the data
// source reads the server's clock in a round trip of its own before the call's own ones
describe('the time of the data source on valkey', () => {
    it('costs a filter no round trip more than a date does', async () => {
        const batch: string = UUIDUtilities.generate();
        await stamps.create({ batch, at: new Date(0) });

        const withDate: number = await countRoundTrips(async () => await stamps.findAll({ where: { batch, at: { before: new Date() } } }));
        const withTime: number = await countRoundTrips(async () => await stamps.findAll({ where: { batch, at: { before: dataSourceNow() } } }));

        expect(withTime).toBe(withDate);
    });

    it('costs a write no round trip more than a date does', async () => {
        const batch: string = UUIDUtilities.generate();

        const withDate: number = await countRoundTrips(async () => await stamps.create({ batch, at: new Date() }));
        const withTime: number = await countRoundTrips(async () => await stamps.create({ batch, at: dataSourceNow() }));

        expect(withTime).toBe(withDate);
    });
});