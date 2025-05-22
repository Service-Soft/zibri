import { Entity, Property } from "zibri";
import { Company } from "./company.model";

@Entity()
export class User {
    @Property.string({ primary: true })
    id!: string;

    @Property.number()
    value!: number;

    @Property.manyToOne({ target: () => Company, inverseSide: 'users' })
    company!: Company;

    @Property.boolean()
    isAdmin!: boolean;
}