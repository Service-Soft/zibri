import { Property } from 'zibri';

export class PetstoreUser {

    @Property.number({ required: false })
    'id'?: number;

    @Property.string({ required: false })
    'username'?: string;

    @Property.string({ required: false })
    'firstName'?: string;

    @Property.string({ required: false })
    'lastName'?: string;

    @Property.string({ required: false })
    'email'?: string;

    @Property.string({ required: false })
    'password'?: string;

    @Property.string({ required: false })
    'phone'?: string;

    @Property.number({ required: false })
    'userStatus'?: number;
}