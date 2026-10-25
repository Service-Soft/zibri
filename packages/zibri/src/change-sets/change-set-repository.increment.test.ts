import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { ChangeSetEntity } from './models/change-set-entity.model';
import { ChangeSetType } from './models/change-set-type.enum';
import { ChangeSet, CreateChangeSetData } from './models/change-set.model';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';

@Entity({ tenant: 'shared', allowOrphan: true })
class Tally extends BaseEntity implements ChangeSetEntity {
    @Property.string()
    name!: string;

    @Property.number({ format: 'integer' })
    count!: number;

    @Property.oneToMany({ target: () => ChangeSet, inverseSide: 'changeSetEntityId' })
    changeSets!: ChangeSet[];
}

// in memory, so that what a change set records for an amount can be watched without a container
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, Tally],
    repositories: defaultTestServerRepositories
});

describe('ChangeSetRepository - an amount added by updateAll', () => {
    let server: StartedTestServer;
    let tallies: Repository<Tally>;
    let changeSets: Repository<ChangeSet, CreateChangeSetData>;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        tallies = inject(repositoryTokenFor(Tally));
        changeSets = inject(repositoryTokenFor(ChangeSet));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('records the value each row holds after the amount was added, not the amount', async () => {
        const first: Tally = await tallies.create({ name: 'first', count: 1 });
        const second: Tally = await tallies.create({ name: 'second', count: 10 });

        await tallies.updateAll({ id: { oneOf: [first.id, second.id] } }, { count: { increment: 5 } });

        for (const [tally, before, after] of [[first, 1, 6], [second, 10, 15]] as const) {
            const recorded: ChangeSet[] = await changeSets.findAll({ where: { changeSetEntityId: tally.id, type: ChangeSetType.UPDATE } });
            expect(recorded.flatMap(c => c.changes).map(c => [c.key, c.previousValue, c.newValue])).toEqual([['count', before, after]]);
        }
    });
});