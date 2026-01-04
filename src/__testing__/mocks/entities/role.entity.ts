import { User } from './user.entity';
import { Entity, Property } from '../../../entity';

@Entity()
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