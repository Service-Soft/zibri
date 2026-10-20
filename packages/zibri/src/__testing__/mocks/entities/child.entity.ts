import { Parent } from './parent.entity.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { type Relation } from '../../../entity/models/relation.type.ts';

@Entity({ tenant: 'shared' })
export class Child {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    name!: string;

    @Property.manyToOne({ target: () => Parent, joinColumn: 'parentId', inverseSide: 'children' })
    parent!: Relation<Parent>;

    @Property.string({ format: 'uuid' })
    parentId!: string;
}