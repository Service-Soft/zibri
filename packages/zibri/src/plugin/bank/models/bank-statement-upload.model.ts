import { Property } from '../../../entity/decorators/property.decorator';
import { File } from '../../../parsing/form-data/file.model';
import { BankLimits } from './bank-limits.model';

/**
 * A CAMT.053 file, as `POST /statements` of the `BankController` takes it in a multipart body.
 */
export class BankStatementUpload {
    /**
     * The file.
     */
    // of any mime type: what a browser sends for an xml file depends on its system, and the import reads the file
    // as a CAMT.053 statement or refuses it
    @Property.file({ allowedMimeTypes: 'all', maxSize: BankLimits.FILE_MAX_SIZE })
    file!: File;
}