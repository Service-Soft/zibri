import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Relation } from '../../entity/models/relation.type.ts';
import { createInMemoryDataSource } from 'zibri-testing';

import { Repository } from './repository.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';

// When a property's `default` fills it in: when a row is created, the models it holds included, and
// when a write creates a related row. An update writes what it is given - a partial update changing
// one thing changes nothing else - so it fills nothing in, not even into a nested value it writes.
// In memory, as which writes fill defaults in is decided by the repository's hook alone

class Phone {
    @Property.string()
    number!: string;

    @Property.string({ default: 'mobile', required: false })
    kind?: string;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class Member extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.string({ default: 'active', required: false })
    status?: string | null;

    @Property.array({ items: { type: 'object', cls: () => Phone }, required: false })
    phones?: Phone[];

    @Property.oneToMany({ target: () => Badge, inverseSide: 'member' })
    badges?: Badge[];
}

@Entity({ tenant: 'shared', allowOrphan: true })
class Badge extends BaseEntity {
    @Property.string()
    label!: string;

    @Property.string({ default: 'bronze', required: false })
    tier?: string;

    @Property.manyToOne({ target: () => Member, joinColumn: 'memberId', inverseSide: 'badges' })
    member!: Relation<Member>;

    @Property.string({ format: 'uuid', required: false })
    memberId?: string;
}

/**
 * The data a member is created and updated with.
 */
type MemberData = {
    name?: string,
    status?: string | null,
    phones?: Phone[],
    badges?: { label: string, tier?: string }[]
};

let server: StartedTestServer | undefined;
let members: Repository<Member, MemberData & { name: string }, MemberData>;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Member, Badge] })]
    });
    members = inject(repositoryTokenFor(Member));
}, 15000);

afterAll(async () => {
    await server?.shutdown();
}, 15000);

describe('when a property\'s default fills it in', () => {
    it('fills in a property and a nested model a row is created without', async () => {
        const created: Member = await members.create({ name: 'ada', phones: [{ number: '1' }] });

        expect(created.status).toBe('active');
        expect(created.phones).toEqual([{ number: '1', kind: 'mobile' }]);
    });

    it('stores null as a value rather than filling it in', async () => {
        // eslint-disable-next-line unicorn/no-null
        const created: Member = await members.create({ name: 'bob', status: null });

        expect(created.status).toBeNull();
    });

    it('keeps what is stored for a property an update leaves out', async () => {
        const created: Member = await members.create({ name: 'cyd', status: 'paused' });

        const updated: Member = await members.updateById(created.id, { name: 'cyd 2' });

        expect(updated.status).toBe('paused');
    });

    it('fills nothing into a nested value an update writes', async () => {
        const created: Member = await members.create({ name: 'dan' });

        const updated: Member = await members.updateById(created.id, { phones: [{ number: '2' }] });

        expect(updated.phones).toEqual([{ number: '2' }]);
    });

    it('fills in a related row an update creates', async () => {
        const created: Member = await members.create({ name: 'eve' });

        const updated: Member = await members.updateById(created.id, { badges: [{ label: 'first' }] }, { relations: ['badges'] });

        expect(updated.badges?.map(b => b.tier)).toEqual(['bronze']);
    });
});