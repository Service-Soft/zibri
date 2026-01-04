import { Property } from 'zibri';

export class PetstoreUploadFile {

    @Property.string({ required: false })
    additionalMetadata?: string;

    @Property.string({ required: false })
    file?: string;
}