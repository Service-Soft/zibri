import { User } from './user.entity.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { type Relation } from '../../../entity/models/relation.type.ts';

@Entity({ tenant: 'shared', allowOrphan: true })
export class Profile {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    bio!: string;

    @Property.belongsToOne({ target: () => User, joinColumn: 'userId', inverseSide: 'profile' })
    user!: Relation<User>;

    @Property.string({ format: 'uuid' })
    userId!: string;
}