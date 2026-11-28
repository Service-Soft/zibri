import { Property } from '../../../../entity/decorators/property.decorator';
import { File } from '../../../../parsing/form-data/file.model';

/**
 * The transmission protocol of an E-Bilanz filed by hand, as `POST /fiscal-years/:id/manual-filing` of the
 * `EBilanzController` takes it as a multipart body.
 */
export class EBilanzProtocolUpload {
    /**
     * The protocol, such as the pdf the program it was sent with wrote.
     */
    @Property.file({ allowedMimeTypes: 'all', maxSize: '25mb' })
    protocol!: File;
}
