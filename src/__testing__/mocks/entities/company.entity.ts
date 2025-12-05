import { User } from './user.entity';
import { Entity, Property } from '../../../entity';
import { BaseEntity } from '../../../entity/base-entity.model';

@Entity()
export class Company extends BaseEntity {
    @Property.belongsToOne({ target: () => User, inverseSide: 'company' })
    owner!: User;
}