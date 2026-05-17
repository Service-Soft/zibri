import { User } from './user.entity';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';

@Entity({ allowOrphan: true })
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