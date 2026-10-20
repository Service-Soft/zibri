import { faker } from '@faker-js/faker';

import { Address, mockAddress } from './address.model.ts';
import { Company } from './company.entity.ts';
import { Profile } from './profile.entity.ts';
import { Role } from './role.entity.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { type Relation } from '../../../entity/models/relation.type.ts';
import { OmitStrict } from '../../../types/omit-strict.type.ts';

@Entity({ tenant: 'shared', allowOrphan: true })
export class User {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    name!: string;

    @Property.hasOne({ target: () => Profile, inverseSide: 'user' })
    profile?: Relation<Profile>;

    @Property.manyToMany({
        target: () => Role,
        inverseSide: 'users',
        joinTable: true
    })
    roles!: Role[];

    @Property.number()
    age!: number;

    @Property.boolean()
    active!: boolean;

    @Property.array({ items: { type: 'string' } })
    tags!: string[];

    @Property.date()
    created!: Date;

    @Property.object({ cls: () => Address })
    address!: Address;

    @Property.hasOne({ target: () => Company, inverseSide: 'owner' })
    company!: Relation<Company>;
}

export type UserCreateData = OmitStrict<User, 'company' | 'id' | 'profile' | 'roles'>;

export function mockCreateUserData(data: Partial<UserCreateData> = {}): UserCreateData {
    return {
        active: faker.datatype.boolean(),
        age: faker.number.int(),
        created: faker.date.past(),
        name: faker.person.fullName(),
        tags: faker.helpers.arrayElements(['admin', 'user']),
        address: mockAddress(),
        ...data
    };
}