import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { User } from './user.entity';

@Entity({ tenant: 'shared', allowOrphan: true })
export class Company extends BaseEntity {
    @Property.belongsToOne({ target: () => User, joinColumn: 'ownerId', inverseSide: 'company' })
    owner!: User;

    @Property.string({ format: 'uuid' })
    ownerId!: string;
}