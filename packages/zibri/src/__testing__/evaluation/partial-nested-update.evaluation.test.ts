import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/01-data-layer.md M61 - an update takes a partial nested object and
 * replaces the stored one with it.
 *
 * The data of an update is typed `DeepPartial`, so the compiler accepts `{ address: { number: '42' } }`
 * as a change to one property of the address. The write stores it as the whole address, and every
 * property it leaves out is gone. Somebody sending that update expects the number to change and
 * nothing else.
 *
 * In memory, as what an update makes of the data it is given is decided by the repository before any
 * store sees it.
 *
 * Every expectation describes the fixed behavior, so this file is red until the finding is closed.
 * See ./README.md for why.
 */

class Address {
    @Property.string()
    street!: string;

    @Property.string()
    number!: string;

    @Property.string({ required: false })
    note?: string;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class Resident extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.object({ cls: () => Address })
    address!: Address;
}

let server: StartedTestServer | undefined;
let residents: Repository<Resident>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Resident] })] });
    residents = inject(repositoryTokenFor(Resident));
}, 15000);

afterAll(async () => {
    await server?.shutdown();
}, 15000);

describe('evaluation/01-data-layer M61 - a partial nested object in an update', () => {
    it('changes what updateById names in a nested object and keeps the rest', async () => {
        const created: Resident = await residents.create({ name: 'ada', address: { street: 'Main', number: '1', note: 'back door' } });

        await residents.updateById(created.id, { address: { number: '42' } });

        expect((await residents.findById(created.id)).address).toEqual({ street: 'Main', number: '42', note: 'back door' });
    });

    it('changes what updateAll names in a nested object and keeps the rest', async () => {
        const created: Resident = await residents.create({ name: 'bob', address: { street: 'Side', number: '2' } });

        await residents.updateAll({ name: 'bob' }, { address: { number: '43' } });

        expect((await residents.findById(created.id)).address).toEqual({ street: 'Side', number: '43' });
    });
});