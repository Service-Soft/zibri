import { EmailAttachment } from './email-attachment.model';
import { EmailPriority } from './email-priority.enum';
import { EmailStatus } from './email-status.enum';
import { BaseEntity, Entity, Property } from '../../entity';

/**
 * Definition of a Email.
 */
@Entity()
export class Email implements BaseEntity {
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string({ primary: true })
    id!: string;

    /**
     * The createdAt date. Is set to now by default.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;

    /**
     * Optional id of a userId to which this email belongs.
     */
    @Property.string({ format: 'uuid', required: false })
    userId?: string;

    /**
     * Whether or not the email should be stored in the db, even after it has been sent.
     */
    @Property.boolean()
    persist!: boolean;

    /**
     * The html content of the email.
     */
    @Property.string()
    html!: string;

    /**
     * The subject of the email.
     */
    @Property.string()
    subject!: string;

    /**
     * The sender from which the email should be sent.
     */
    @Property.string({ format: 'email' })
    sender!: string;

    /**
     * The recipients that should receive the email.
     */
    @Property.array({ items: { type: 'string', format: 'email' } })
    recipients!: string[];

    /**
     * The recipients that should receive the email as cc.
     */
    @Property.array({ items: { type: 'string', format: 'email' }, required: false })
    cc?: string[];

    /**
     * The recipients that should receive the email as bcc.
     */
    @Property.array({ items: { type: 'string', format: 'email' }, required: false })
    bcc?: string[];

    /**
     * The attachments of the email.
     */
    @Property.array({ items: { type: 'object', cls: () => EmailAttachment }, required: false })
    attachments?: EmailAttachment[];

    /**
     * The emails status, like QUEUED, SENT or FAILED etc.
     */
    @Property.string({ enum: EmailStatus })
    status!: EmailStatus;

    /**
     * The priority of the email.
     */
    @Property.string({ enum: EmailPriority })
    priority!: EmailPriority;
}