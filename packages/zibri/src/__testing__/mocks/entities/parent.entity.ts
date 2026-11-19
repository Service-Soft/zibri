import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { Child } from './child.entity';

@Entity({ tenant: 'shared' })
export class Parent {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => Child, inverseSide: 'parent' })
    children!: Child[];
}