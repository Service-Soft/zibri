import { Child } from './child.entity.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';

@Entity({ tenant: 'shared' })
export class Parent {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => Child, inverseSide: 'parent' })
    children!: Child[];
}