import { Entity, Property } from "zibri";

@Entity()
export class Test {
    @Property({ type: 'string', primary: true })
    id!: string;
    @Property({ type: 'number' })
    value!: number;
}