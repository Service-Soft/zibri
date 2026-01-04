import { User } from './user.entity';
import { Entity, Property } from '../../../entity';

@Entity()
export class Profile {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    bio!: string;

    @Property.belongsToOne({ target: () => User, inverseSide: 'profile' })
    user!: User;
}