import { Entity, CombinedType, JwtCredentials, OmitType, Property, BaseUserEntity } from 'zibri';

import { Company } from './company.model';
import { Roles } from './roles.enum';
import { OmitStrict } from '../types';

@Entity()
export class User extends BaseUserEntity(Roles) {
    @Property.manyToOne({ target: () => Company, inverseSide: 'workers', required: false })
    company?: Company;
}

export class UserCreateDto extends CombinedType(
    OmitType(User, ['id', 'roles']),
    OmitType(JwtCredentials, ['id', 'userId', 'email'])
) {}

export type UserCreateData = OmitStrict<User, 'id' | 'company'>;