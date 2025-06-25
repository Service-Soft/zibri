import { MailAttachment } from './mail-attachment.model';
import { MailPriority } from './mail-priority.enum';
import { MailStatus } from './mail-status.enum';
import { BaseEntity, Entity, Property } from '../../entity';

@Entity()
export class Mail implements BaseEntity {
    @Property.string({ primary: true })
    id!: string;

    @Property.date({ default: () => new Date() })
    createdAt!: Date;

    @Property.string({ format: 'uuid', required: false })
    userId?: string;

    @Property.boolean()
    persist!: boolean;

    @Property.string()
    html!: string;

    @Property.string()
    subject!: string;

    @Property.string({ format: 'email' })
    sender!: string;

    @Property.array({ items: { type: 'string', format: 'email' } })
    recipients!: string[];

    @Property.array({ items: { type: 'string', format: 'email' }, required: false })
    cc?: string[];

    @Property.array({ items: { type: 'string', format: 'email' }, required: false })
    bcc?: string[];

    @Property.array({ items: { type: 'object', cls: () => MailAttachment }, required: false })
    attachments?: MailAttachment[];

    @Property.string({ enum: MailStatus })
    status!: MailStatus;

    @Property.string({ enum: MailPriority })
    priority!: MailPriority;
}