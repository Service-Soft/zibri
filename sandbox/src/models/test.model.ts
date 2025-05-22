import { Entity, Property } from "zibri";

@Entity()
export class Test {
    @Property.string({ primary: true })
    id!: string;
    @Property.number()
    value!: number;
}