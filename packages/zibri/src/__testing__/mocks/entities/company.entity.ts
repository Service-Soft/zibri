import { User } from './user.entity.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { type Relation } from '../../../entity/models/relation.type.ts';

@Entity({ tenant: 'shared', allowOrphan: true })
export class Company extends BaseEntity {
    @Property.belongsToOne({ target: () => User, joinColumn: 'ownerId', inverseSide: 'company' })
    owner!: Relation<User>;

    @Property.string({ format: 'uuid' })
    ownerId!: string;
}