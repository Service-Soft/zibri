import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { ChangeSetRepository } from './change-set-repository.ts';
import { ChangeSetEntity } from './models/change-set-entity.model.ts';
import { ChangeSetType } from './models/change-set-type.enum.ts';
import { ChangeSet, CreateChangeSetData } from './models/change-set.model.ts';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../data-source/repository/repository.ts';
import { Transaction } from '../data-source/transaction/transaction.model.ts';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator.ts';
import { inject } from '../di/inject.function.ts';
import { BaseEntity } from '../entity/base-entity.model.ts';
import { Entity } from '../entity/decorators/entity.decorator.ts';
import { Property } from '../entity/decorators/property.decorator.ts';
import { BadRequestError } from '../error-handling/errors/bad-request.error.ts';

@Entity({ tenant: 'shared', allowOrphan: true })
class Gauge extends BaseEntity implements ChangeSetEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => ChangeSet, inverseSide: 'changeSetEntityId' })
    changeSets!: ChangeSet[];
}

// in memory, so a write still waiting in a transaction can be told apart from one that landed
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, Gauge]
});

describe('ChangeSetRepository, given the change set of another row', () => {
    let server: StartedTestServer;
    let gauges: ChangeSetRepository<Gauge>;
    let changeSets: Repository<ChangeSet, CreateChangeSetData>;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        const repository: Repository<Gauge> = inject(repositoryTokenFor(Gauge));
        if (!(repository instanceof ChangeSetRepository)) {
            throw new Error('A change set entity is given a ChangeSetRepository.');
        }
        // eslint-disable-next-line typescript/no-unsafe-assignment
        gauges = repository;
        changeSets = inject(repositoryTokenFor(ChangeSet));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    /**
     * The id of the change set of a row of the given type.
     * @param gaugeId - The row.
     * @param type - Which of its change sets.
     * @param transaction - The transaction it was written in, if any.
     * @returns The id.
     */
    async function changeSetIdOf(gaugeId: string, type: ChangeSetType, transaction?: Transaction): Promise<string> {
        return (await changeSets.findOne({ where: { changeSetEntityId: gaugeId, type }, transaction })).id;
    }

    it('refuses to roll a row back to the change set of another row, and leaves both as they are', async () => {
        const mine: Gauge = await gauges.create({ name: 'mine' });
        await gauges.updateById(mine.id, { name: 'mine, edited' });
        const other: Gauge = await gauges.create({ name: 'other' });
        const othersCreate: string = await changeSetIdOf(other.id, ChangeSetType.CREATE);

        await expect(gauges.rollbackToChangeSet(mine, othersCreate)).rejects.toThrow(BadRequestError);

        expect((await gauges.findById(mine.id)).name).toBe('mine, edited');
        expect(await changeSets.count({ where: { changeSetEntityId: mine.id } })).toBe(2);
    });

    it('rolls back by id inside the transaction the row and its change sets were written in', async () => {
        const transaction: Transaction = await gauges.dataSource.startTransaction();
        const gauge: Gauge = await gauges.create({ name: 'first' }, { transaction });
        const created: string = await changeSetIdOf(gauge.id, ChangeSetType.CREATE, transaction);
        await gauges.updateById(gauge.id, { name: 'second' }, { transaction });

        const rolledBack: Gauge = await gauges.rollbackToChangeSetById(gauge.id, created, true, true, { transaction });

        expect(rolledBack.name).toBe('first');
        await transaction.commit();
    });
});