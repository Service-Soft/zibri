
import { Property } from '../../entity';
import { OmitStrict } from '../../types';

export type MulterFile = OmitStrict<Express.Multer.File, 'buffer' | 'stream' | 'encoding'>;

/**
 * A resolved file from a multipart/form-data request.
 * Has the same properties as the File from multer but adds property metadata.
 */
export class File implements MulterFile {
    @Property.string()
    fieldname: string;

    @Property.string()
    originalname: string;

    @Property.string()
    mimetype: string;

    @Property.number()
    size: number;

    @Property.string()
    destination: string;

    @Property.string()
    filename: string;

    @Property.string()
    path: string;

    constructor(file: MulterFile) {
        this.destination = file.destination;
        this.fieldname = file.fieldname;
        this.filename = file.filename;
        this.mimetype = file.mimetype;
        this.originalname = file.originalname;
        this.path = file.path;
        this.size = file.size;
    }
}