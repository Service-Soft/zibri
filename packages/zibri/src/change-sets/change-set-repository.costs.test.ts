import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, RoundTripCounter } from 'zibri-testing';

import { SoftDeleteEntity } from './models/soft-delete-entity.model';
import { SoftDeleteRepository } from './soft-delete-repository';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { inject } from '../di/inject.function';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { Newable } from '../types/newable.type';

/**
 * What the writes of an entity recording change sets cost, as the calls its repositories make on the
 * store. Compared as the list of calls rather than as a number, so a call that should not be there is
 * named in the difference.
 */

/**
 * Records change sets and soft deletes, with nothing else about it that costs a call.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class CostAccount extends SoftDeleteEntity {
    @Property.string()
    email!: string;
}

const roundTrips: RoundTripCounter = new RoundTripCounter();

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, CostAccount],
    roundTrips
});

let server: StartedTestServer | undefined;
let accounts: SoftDeleteRepository<CostAccount>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    accounts = inject(dataSourceClass).getRepository(CostAccount);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

/**
 * Runs some work and compares the calls it made with the ones expected.
 * @param work - The work.
 * @param expected - The calls it should make, as `Entity.method`.
 */
async function expectCallsOf(work: () => Promise<unknown>, expected: string[]): Promise<void> {
    await roundTrips.resolveCountOf(work);
    const calls: string[] = roundTrips.trips.map(t => t.statement);
    if (calls.join() !== expected.join()) {
        // where each call came from, which the difference alone does not say
        // eslint-disable-next-line no-console
        console.log(roundTrips.describe());
    }
    expect(calls).toEqual(expected);
}

describe('what the writes of an entity recording change sets cost', () => {
    it('updates a row: its before state, the write, and the change set with its change', async () => {
        const account: CostAccount = await accounts.create({ email: 'before@example.com' });

        await expectCallsOf(
            async () => await accounts.updateById(account.id, { email: 'after@example.com' }),
            ['CostAccount.findOne', 'CostAccount.updateAll', 'ChangeSet.insert', 'Change.insert']
        );
    });

    it('soft deletes a row for what updating it costs, less the change it does not record', async () => {
        const account: CostAccount = await accounts.create({ email: 'deleted@example.com' });

        await expectCallsOf(
            async () => await accounts.deleteById(account.id),
            ['CostAccount.findOne', 'CostAccount.updateAll', 'ChangeSet.insert']
        );
    });

    it('creates rows for what one costs, however many there are', async () => {
        await expectCallsOf(
            async () => await accounts.createAll(Array.from({ length: 20 }, (_, i) => ({ email: `created-${i}@example.com` }))),
            ['CostAccount.insert', 'ChangeSet.insert', 'Change.insert']
        );
    });
});