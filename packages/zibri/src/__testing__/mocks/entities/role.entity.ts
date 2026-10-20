import { User } from './user.entity.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';

@Entity({ tenant: 'shared', allowOrphan: true })
export class Role {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    name!: string;

    @Property.manyToMany({
        target: () => User,
        inverseSide: 'roles',
        joinTable: false
    })
    users!: User[];
}