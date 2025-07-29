import { BaseUser, Entity, CombinedType, JwtCredentials, OmitType, Property } from 'zibri';

import { Roles } from './roles.enum';
import { OmitStrict } from '../types';
import { Company } from './company.model';

@Entity()
export class User implements BaseUser<Roles> {
    @Property.string({ primary: true })
    id!: string;

    @Property.string({ unique: true, format: 'email' })
    email!: string;

    @Property.array({ items: { type: 'string', enum: Roles } })
    roles!: Roles[];

    @Property.number()
    value!: number;

    @Property.manyToOne({ target: () => Company })
    company!: Company;
}

export class UserCreateDto extends CombinedType(
    OmitType(User, ['id', 'roles', 'company']),
    OmitType(JwtCredentials, ['id', 'userId', 'email'])
) {}

export type UserCreateData = OmitStrict<User, 'id' | 'company'>;