import { Property } from 'zibri';

export class PetstoreApiResponse {

    @Property.number({ required: false })
    code?: number;

    @Property.string({ required: false })
    type?: string;

    @Property.string({ required: false })
    message?: string;
}