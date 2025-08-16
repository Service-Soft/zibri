import { Parent } from './parent.entity';
import { Entity, Property } from '../../../entity';

@Entity('child')
export class Child {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    name!: string;

    @Property.manyToOne({ target: () => Parent, inverseSide: 'children' })
    parent!: Parent;
}