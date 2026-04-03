import { Property } from '../../entity/decorators/property.decorator';
import { type FsPath } from '../../utilities/fs.utilities';

/**
 * An email attachment, consisting of filename and path.
 */
export class EmailAttachment {
    /**
     * The filename of the attachment.
     */
    @Property.string()
    filename!: string;

    /**
     * The path of the attachment.
     */
    @Property.string()
    path!: FsPath;
}