import { Entity, JwtCredentials, Property, BaseUserEntity, IntersectionClass, OmitClass } from 'zibri';

import { Company } from './company.model';
import { Roles } from './roles.enum';
import { OmitStrict } from '../types';

@Entity()
export class User extends BaseUserEntity(Roles) {
    @Property.string()
    name!: string;

    @Property.manyToOne({ target: () => Company, inverseSide: 'workers', required: false })
    company?: Company;
}

export class UserCreateDto extends IntersectionClass(
    OmitClass(User, ['id', 'roles']),
    OmitClass(JwtCredentials, ['id', 'userId', 'email'])
) {}

export type UserCreateData = OmitStrict<User, 'id' | 'company'>;