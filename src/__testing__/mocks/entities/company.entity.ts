import { User } from './user.entity';
import { BaseEntity, Entity, Property } from '../../../entity';

@Entity()
export class Company extends BaseEntity {
    @Property.belongsToOne({ target: () => User, inverseSide: 'company' })
    owner!: User;
}