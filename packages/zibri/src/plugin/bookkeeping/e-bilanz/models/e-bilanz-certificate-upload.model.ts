import { Property } from '../../../../entity/decorators/property.decorator';
import { File } from '../../../../parsing/form-data/file.model';

/**
 * The ELSTER certificate of the company and its PIN, as `PUT /settings/certificate` of the `EBilanzController` takes
 * them as a multipart body.
 */
export class EBilanzCertificateUpload {
    /**
     * The certificate, the `.pfx` file Mein ELSTER hands out.
     */
    @Property.file({ allowedMimeTypes: 'all', maxSize: '1mb' })
    certificate!: File;

    /**
     * The PIN of the certificate, 6 to 128 printable characters.
     */
    @Property.string({ minLength: 6, maxLength: 128 })
    pin!: string;
}