import { BaseEntity, Entity, Property } from 'zibri';

import { User } from './user.model';

@Entity()
export class Company implements BaseEntity {
    @Property.string({ primary: true })
    id!: string;

    @Property.oneToMany({ target: () => User })
    workers!: User[];
}