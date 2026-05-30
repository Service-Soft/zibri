import { Property } from 'zibri';

export class PetstoreCategory {

    @Property.number({ required: false })
    'id'?: number;

    @Property.string({ required: false })
    'name'?: string;
}