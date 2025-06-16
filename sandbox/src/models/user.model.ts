import { BaseUser, Entity, IntersectionType, JwtCredentials, OmitType, Property } from 'zibri';

import { Roles } from './roles.enum';
import { OmitStrict } from '../types';
import { Company } from './company.model';

@Entity()
export class User implements BaseUser<Roles> {
    @Property.string({ primary: true })
    id!: string;

    @Property.string({ unique: true })
    email!: string;

    @Property.array({ items: { type: 'string' } })
    roles!: Roles[];

    @Property.number()
    value!: number;

    @Property.manyToOne({ target: () => Company })
    company!: Company;
}

export class UserCreateDto extends IntersectionType(
    OmitType(User, ['id', 'roles', 'company']),
    OmitType(JwtCredentials, ['id', 'userId', 'username'])
) {}

export type UserCreateData = OmitStrict<User, 'id' | 'company'>;