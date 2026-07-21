import { Parent } from './parent.entity';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';

@Entity()
export class Child {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    name!: string;

    @Property.manyToOne({ target: () => Parent, joinColumn: 'parentId', inverseSide: 'children' })
    parent!: Parent;

    @Property.string({ format: 'uuid' })
    parentId!: string;
}