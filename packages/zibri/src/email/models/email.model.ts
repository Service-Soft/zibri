import { EmailAttachment } from './email-attachment.model';
import { EmailPriority } from './email-priority.enum';
import { EmailStatus } from './email-status.enum';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';

/**
 * Definition of a Email.
 */
@Entity({ allowOrphan: true, defaultOrder: { createdAt: 'ASC' } })
export class Email extends BaseEntity {
    /**
     * The tenant the mail was queued in, or null for one queued outside every tenant.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;

    /**
     * The createdAt date. Is set to now by default.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;

    /**
     * Optional id of a userId to which this email belongs.
     */
    @Property.string({ format: 'uuid', required: false })
    userId?: string | null;

    /**
     * Whether or not the email should be stored in the db, even after it has been sent.
     *
     * Only decides what happens to a mail that was **sent**. One that failed is kept either way -
     * the row is the only record that it was ever owed, and throwing it away leaves nothing to answer
     * "did the password reset go out" with.
     */
    @Property.boolean()
    persist!: boolean;

    /**
     * The addresses the mail server refused, or undefined if it refused none.
     *
     * What makes a failed row a trail rather than a tombstone: a mail server routinely accepts some
     * recipients of one message and rejects others, so "this failed" is not an answer on its own -
     * the useful part is which address it failed for.
     */
    @Property.array({ items: { type: 'string', format: 'email' }, required: false })
    rejectedRecipients?: string[] | null;

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
    cc?: string[] | null;

    /**
     * The recipients that should receive the email as bcc.
     */
    @Property.array({ items: { type: 'string', format: 'email' }, required: false })
    bcc?: string[] | null;

    /**
     * The attachments of the email.
     */
    @Property.array({ items: { type: 'object', cls: () => EmailAttachment }, required: false })
    attachments?: EmailAttachment[] | null;

    /**
     * Where the recipients leave the mailing list the email is sent to, or undefined for an email
     * sent to no list.
     *
     * Sent as the `List-Unsubscribe` header, along with `List-Unsubscribe-Post`: a mailbox provider
     * shows its own unsubscribe button for it, which posts `List-Unsubscribe=One-Click` to this url
     * (RFC 8058).
     */
    @Property.string({ required: false })
    listUnsubscribeUrl?: string | null;

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

    /**
     * How many times sending the email threw, eg. Because its server could not be reached.
     */
    @Property.number({ format: 'integer', default: 0 })
    attempts!: number;

    /**
     * When a queued email whose send threw is tried again, or undefined for one that is due now.
     */
    @Property.date({ required: false })
    retryAt?: Date | null;
}