import { Property } from '../../entity/decorators/property.decorator';

/**
 * A file attached to an email, carried on the queued email itself.
 *
 * Whichever instance sends the email reads its attachments from the queued row, so the content is
 * part of the attachment rather than a path to it.
 */
export class EmailAttachment {
    /**
     * The name of the file, as the recipient sees it. Its extension decides the content type.
     */
    @Property.string()
    filename!: string;

    /**
     * The content of the file, base64 encoded. Eg. `buffer.toString('base64')`.
     */
    @Property.string()
    base64Content!: string;
}