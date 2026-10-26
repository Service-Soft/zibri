import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, RoundTripCounter } from 'zibri-testing';

import { SoftDeleteEntity } from './models/soft-delete-entity.model';
import { SoftDeleteRepository } from './soft-delete-repository';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';

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

/**
 * Soft deletes, and takes its tasks along when it is deleted.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
class CostProject extends SoftDeleteEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => CostTask, inverseSide: 'project', cascade: ['insert', 'update', 'remove'] })
    tasks!: CostTask[];
}

/**
 * A row a project takes along when it is soft deleted.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
class CostTask extends SoftDeleteEntity {
    @Property.string()
    title!: string;

    @Property.manyToOne({ target: () => CostProject, joinColumn: 'projectId', inverseSide: 'tasks' })
    project!: CostProject;

    @Property.string({ format: 'uuid' })
    projectId!: string;
}

const roundTrips: RoundTripCounter = new RoundTripCounter();

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, CostAccount, CostProject, CostTask],
    repositories: defaultTestServerRepositories,
    roundTrips
});

let server: StartedTestServer | undefined;
let accounts: SoftDeleteRepository<CostAccount>;
let projects: SoftDeleteRepository<CostProject>;
let tasks: SoftDeleteRepository<CostTask>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    accounts = inject(dataSourceClass).getRepository(CostAccount);
    projects = inject(dataSourceClass).getRepository(CostProject);
    tasks = inject(dataSourceClass).getRepository(CostTask);
}, TestTimeouts.inMemory.start);

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

    // 01 §D10: the rows a soft delete takes along were marked one owner at a time, a whole update with
    // its change sets for every project
    it('soft deletes rows and the rows they take along for what one costs, however many there are', async () => {
        const seeded: (name: string, count: number) => Promise<CostProject[]> = async (name, count) => await projects.createAll(
            Array.from({ length: count }, () => ({ name, tasks: [{ title: 'plan' }, { title: 'build' }] }))
        );
        await seeded('one', 1);
        const many: CostProject[] = await seeded('many', 20);

        await roundTrips.resolveCountOf(async () => await projects.deleteAll({ name: 'one' }));
        const forOne: string[] = roundTrips.trips.map(t => t.statement);
        await roundTrips.resolveCountOf(async () => await projects.deleteAll({ name: 'many' }));
        const forMany: string[] = roundTrips.trips.map(t => t.statement);

        expect(forMany).toEqual(forOne);
        // each task still notes the project that took it along, which is what restoring that project
        // restores it by
        const taken: CostTask[] = await tasks.findAll({ where: { projectId: { oneOf: many.map(p => p.id) } }, deleted: 'only' });
        expect(taken).toHaveLength(40);
        expect(taken.every(task => task.deletedWith === task.projectId)).toBe(true);
    });
});