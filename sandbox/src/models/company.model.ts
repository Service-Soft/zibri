import { Entity, Property } from "zibri";
import { User } from "./user.model";

@Entity()
export class Company {
    @Property.string({ primary: true })
    id!: string;

    @Property.oneToMany({ target: () => User, inverseSide: 'company' })
    users!: User[];
}