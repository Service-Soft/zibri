import { faker } from '@faker-js/faker';

import { Address, mockAddress } from './address.model';
import { Company } from './company.entity';
import { Profile } from './profile.entity';
import { Role } from './role.entity';
import { Entity, Property } from '../../../entity';
import { OmitStrict } from '../../../types';

@Entity()
export class User {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    name!: string;

    @Property.hasOne({ target: () => Profile, inverseSide: 'user' })
    profile?: Profile;

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
    company!: Company;
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