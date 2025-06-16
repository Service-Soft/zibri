import { Property } from '../../entity';

/**
 * A resolved file from a multipart/form-data request.
 * Has the same properties as the File from multer but adds property metadata.
 */
export class File implements Omit<Express.Multer.File, 'stream'> {
    @Property.string()
    fieldname!: string;

    @Property.string()
    originalname!: string;

    @Property.string()
    encoding!: string;

    @Property.string()
    mimetype!: string;

    @Property.number()
    size!: number;

    // @property({
    //     type: 'object',
    //     required: true
    // })
    // stream: Readable;

    @Property.string()
    destination!: string;

    @Property.string()
    filename!: string;

    @Property.string()
    path!: string;

    @Property.object({ cls: () => Buffer })
    buffer!: Buffer;
}