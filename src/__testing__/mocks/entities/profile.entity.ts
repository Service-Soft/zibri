import { User } from './user.entity';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';

@Entity({ allowOrphan: true })
export class Profile {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    bio!: string;

    @Property.belongsToOne({ target: () => User, joinColumn: 'userId', inverseSide: 'profile' })
    user!: User;

    @Property.string({ format: 'uuid' })
    userId!: string;
}