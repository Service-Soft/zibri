import { Property } from 'zibri';

export class PetstoreUpdatePetWithForm {

    @Property.string({ required: false })
    name?: string;

    @Property.string({ required: false })
    status?: string;
}