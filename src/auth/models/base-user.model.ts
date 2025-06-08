import { BaseEntity } from '../../entity';

export type BaseUser<Role extends string> = BaseEntity & {
    email: string,
    roles: Role[]
};