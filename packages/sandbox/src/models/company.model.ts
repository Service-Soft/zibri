import { BaseEntity, Entity, Property } from 'zibri';

import { User } from './user.model';

@Entity({ defaultOrder: { workers: 'ASC' } })
export class Company extends BaseEntity {
    @Property.oneToMany({ target: () => User, inverseSide: 'company' })
    workers!: User[];
}