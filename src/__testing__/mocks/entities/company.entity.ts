import { User } from './user.entity';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';

@Entity()
export class Company extends BaseEntity {
    @Property.belongsToOne({ target: () => User, inverseSide: 'company' })
    owner!: User;
}