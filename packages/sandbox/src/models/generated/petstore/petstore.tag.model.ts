import { Property } from 'zibri';

export class PetstoreTag {

    @Property.number({ required: false })
    'id'?: number;

    @Property.string({ required: false })
    'name'?: string;
}