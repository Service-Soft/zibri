import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Repository } from './repository';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

// What a write leaves of the data it was given. Every hook writes into the copy a write works on -
// encrypting, hashing, filling in defaults - and an object or array the data holds is part of that
// copy, not part of what the caller still holds and may write again. In memory, as what a write
// changes in its copy is decided by the repository alone, whichever store holds the rows

class Contact {
    @Property.string({ encryption: true })
    phone!: string;

    @Property.string({ default: 'web', required: false })
    source?: string;
}

@Entity({ tenant: 'shared', allowOrphan: true, uniques: [['handle']] })
class Profile extends BaseEntity {
    @Property.string()
    handle!: string;

    @Property.object({ cls: () => Contact })
    contact!: Contact;

    @Property.array({ items: { type: 'object', cls: () => Contact }, required: false })
    previous?: Contact[];
}

/**
 * The data a profile is created from.
 */
type ProfileData = Omit<Profile, keyof BaseEntity>;

let server: StartedTestServer | undefined;
let profiles: Repository<Profile>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Profile] })] });
    profiles = inject(repositoryTokenFor(Profile));
}, 15000);

afterAll(async () => {
    await server?.shutdown();
}, 15000);

/**
 * Data no other case uses, with a plain object as its contact and a contact built from the class in
 * its array, since both are what a caller hands over.
 * @returns The data.
 */
function freshData(): ProfileData {
    return {
        handle: `profile-${UUIDUtilities.generate()}`,
        contact: { phone: '+49 1' },
        previous: [Object.assign(new Contact(), { phone: '+49 2' })]
    };
}

/**
 * Asserts that the given data still holds what the caller wrote: no encrypted value, no default.
 * @param data - The data a write was given.
 */
function expectUntouched(data: Pick<ProfileData, 'contact' | 'previous'>): void {
    expect(data.contact).toEqual({ phone: '+49 1' });
    expect({ ...data.previous?.[0] }).toEqual({ phone: '+49 2' });
}

describe('what a write leaves of the nested objects it was given', () => {
    it('leaves them as they were on create, and stores what they said', async () => {
        const data: ProfileData = freshData();

        const created: Profile = await profiles.create(data);

        expectUntouched(data);
        expect(created.contact).toEqual({ phone: '+49 1', source: 'web' });
    });

    it('leaves them as they were on createAll', async () => {
        const data: ProfileData = freshData();

        await profiles.createAll([data]);

        expectUntouched(data);
    });

    it('leaves them as they were on updateById', async () => {
        const created: Profile = await profiles.create(freshData());
        const change: Pick<ProfileData, 'contact' | 'previous'> = freshData();

        await profiles.updateById(created.id, change);

        expectUntouched(change);
    });

    it('leaves them as they were on updateAll', async () => {
        const created: Profile = await profiles.create(freshData());
        const change: Pick<ProfileData, 'contact' | 'previous'> = freshData();

        await profiles.updateAll({ handle: created.handle }, change);

        expectUntouched(change);
    });

    it('leaves them as they were on an update of several rows by their ids', async () => {
        const created: Profile = await profiles.create(freshData());
        const change: Pick<ProfileData, 'contact' | 'previous'> = freshData();

        await profiles.updateAll({ id: { oneOf: [created.id] } }, change);

        expectUntouched(change);
    });

    it('leaves them as they were on upsert', async () => {
        const data: ProfileData = freshData();

        await profiles.upsert({ handle: data.handle }, data, { handle: { set: data.handle } });

        expectUntouched(data);
    });
});