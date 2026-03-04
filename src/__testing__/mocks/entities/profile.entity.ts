import { User } from './user.entity';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';

@Entity()
export class Profile {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    bio!: string;

    @Property.belongsToOne({ target: () => User, inverseSide: 'profile' })
    user!: User;
}