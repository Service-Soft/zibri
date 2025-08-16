import { Child } from './child.entity';
import { Entity, Property } from '../../../entity';

@Entity('parent')
export class Parent {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => Child, inverseSide: 'parent' })
    children!: Child[];
}