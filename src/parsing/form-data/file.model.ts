
import { Property } from '../../entity';
import { OmitStrict } from '../../types';

/**
 * The Multer file type.
 */
export type MulterFile = OmitStrict<Express.Multer.File, 'buffer' | 'stream' | 'encoding'>;

/**
 * A resolved file from a multipart/form-data request.
 * Has the same properties as the File from multer but adds property metadata.
 */
export class File implements MulterFile {
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string()
    fieldname: string;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string()
    originalname: string;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string()
    mimetype: string;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.number()
    size: number;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string()
    destination: string;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string()
    filename: string;

    // eslint-disable-next-line jsdoc/require-jsdoc
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