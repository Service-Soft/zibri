import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { ChangeSetRepository } from './change-set-repository';
import { ChangeSetEntity } from './models/change-set-entity.model';
import { ChangeSetType } from './models/change-set-type.enum';
import { ChangeSet, CreateChangeSetData } from './models/change-set.model';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';

// an update merges an object it gives into the stored one, so what a change set records of it, and
// what a reset writes back, are the whole object rather than the part of it the update named

class Mailbox {
    @Property.string()
    street!: string;

    @Property.string()
    number!: string;

    @Property.string({ required: false })
    note?: string | null;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class Household extends BaseEntity implements ChangeSetEntity {
    @Property.string()
    name!: string;

    @Property.object({ cls: () => Mailbox })
    mailbox!: Mailbox;

    @Property.oneToMany({ target: () => ChangeSet, inverseSide: 'changeSetEntityId' })
    changeSets!: ChangeSet[];
}

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, Household]
});

describe('ChangeSetRepository, given an update of part of an object', () => {
    let server: StartedTestServer;
    let households: ChangeSetRepository<Household>;
    let changeSets: Repository<ChangeSet, CreateChangeSetData>;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        const repository: Repository<Household> = inject(repositoryTokenFor(Household));
        if (!(repository instanceof ChangeSetRepository)) {
            throw new Error('A change set entity is given a ChangeSetRepository.');
        }
        // eslint-disable-next-line typescript/no-unsafe-assignment
        households = repository;
        changeSets = inject(repositoryTokenFor(ChangeSet));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('records the object as the update left it', async () => {
        const household: Household = await households.create({ name: 'ada', mailbox: { street: 'Main', number: '1' } });

        await households.updateById(household.id, { mailbox: { number: '2' } });

        const update: ChangeSet = await changeSets.findOne({
            where: { changeSetEntityId: household.id, type: ChangeSetType.UPDATE },
            relations: ['changes']
        });
        expect(update.changes.map(c => [c.key, c.previousValue, c.newValue])).toEqual([['mailbox', { street: 'Main', number: '1' }, { street: 'Main', number: '2' }]]);
    });

    it('takes back what an update added to the object when its change set is reset', async () => {
        const household: Household = await households.create({ name: 'bob', mailbox: { street: 'Main', number: '1' } });
        await households.updateById(household.id, { mailbox: { number: '2', note: 'ring twice' } });
        const update: ChangeSet = await changeSets.findOne({ where: { changeSetEntityId: household.id, type: ChangeSetType.UPDATE } });

        await households.resetSingleChangeSetById(household.id, update.id);

        // eslint-disable-next-line unicorn/no-null
        expect((await households.findById(household.id)).mailbox).toEqual({ street: 'Main', number: '1', note: null });
    });
});