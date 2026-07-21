import { Child } from './child.entity';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';

@Entity()
export class Parent {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => Child, inverseSide: 'parent' })
    children!: Child[];
}