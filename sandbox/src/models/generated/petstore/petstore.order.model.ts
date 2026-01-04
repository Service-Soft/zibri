import { Property } from 'zibri';

export class PetstoreOrder {

    @Property.number({ required: false })
    id?: number;

    @Property.number({ required: false })
    petId?: number;

    @Property.number({ required: false })
    quantity?: number;

    @Property.date({ required: false })
    shipDate?: Date;

    @Property.string({ required: false })
    status?: 'placed' | 'approved' | 'delivered';

    @Property.boolean({ required: false })
    complete?: boolean;
}