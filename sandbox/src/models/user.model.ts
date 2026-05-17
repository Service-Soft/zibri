import { Entity, JwtCredentials, Property, BaseUserEntity, IntersectionClass, OmitClass, OmitStrict } from 'zibri';

import { Company } from './company.model';
import { Roles } from './roles.enum';

@Entity()
export class User extends BaseUserEntity(Roles) {
    @Property.string()
    name!: string;

    @Property.manyToOne({ target: () => Company, inverseSide: 'workers', joinColumn: 'companyId', required: false })
    company?: Company;

    @Property.string({ format: 'uuid', required: false })
    companyId?: string;
}

export class UserCreateDto extends IntersectionClass(
    OmitClass(User, ['id', 'roles']),
    OmitClass(JwtCredentials, ['id', 'userId', 'email'])
) {}

export type UserCreateData = OmitStrict<User, 'id' | 'company'>;