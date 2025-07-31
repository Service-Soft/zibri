import { BaseUser, Entity, CombinedType, JwtCredentials, OmitType, Property } from 'zibri';

import { Roles } from './roles.enum';

@Entity()
export class User implements BaseUser<Roles> {
    @Property.string({ primary: true })
    id!: string;

    @Property.string({ unique: true, format: 'email' })
    email!: string;

    @Property.array({ items: { type: 'string', enum: Roles } })
    roles!: Roles[];
}

export class UserCreateDto extends CombinedType(
    OmitType(User, ['id', 'roles']),
    OmitType(JwtCredentials, ['id', 'userId', 'email'])
) {}

export type UserCreateData = Omit<User, 'id'>;