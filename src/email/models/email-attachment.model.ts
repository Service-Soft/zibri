
import { Property } from '../../entity';

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
    path!: string;
}