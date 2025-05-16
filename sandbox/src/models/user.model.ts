import { Entity, Property } from "zibri";

@Entity()
export class User {
    @Property({ type: 'string', primary: true })
    id!: string;
    @Property({ type: 'number' })
    value!: number;
}