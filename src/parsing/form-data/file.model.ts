import { Property } from '../../entity';
import { type Path } from '../../utilities';

/**
 * A resolved file from a multipart/form-data request.
 */
export class File {
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
    path: Path;

    constructor(file: File) {
        this.destination = file.destination;
        this.fieldname = file.fieldname;
        this.filename = file.filename;
        this.mimetype = file.mimetype;
        this.originalname = file.originalname;
        this.path = file.path;
        this.size = file.size;
    }
}