import { User } from './user.entity';
import { BaseEntity, Entity, Property } from '../../../entity';

@Entity()
export class Company implements BaseEntity {
    @Property.string({ primary: true })
    id!: string;

    @Property.belongsToOne({ target: () => User, inverseSide: 'company' })
    owner!: User;
}