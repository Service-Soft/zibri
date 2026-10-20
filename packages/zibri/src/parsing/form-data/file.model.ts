import { Property } from '../../entity/decorators/property.decorator.ts';
import { type FsPath } from '../../utilities/fs.utilities.ts';

/**
 * A resolved file from a multipart/form-data request.
 */
export class File {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Property.string()
    fieldname: string;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Property.string()
    originalname: string;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Property.string()
    mimetype: string;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Property.number({ format: 'integer' })
    size: number;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Property.string()
    destination: string;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Property.string()
    filename: string;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Property.string()
    path: FsPath;

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