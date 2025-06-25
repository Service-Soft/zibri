import { Readable } from 'stream';

import { Property } from '../../entity';

export class MailAttachment {
    @Property.string()
    name!: string;

    @Property.string()
    path!: string;
}

export type ResolvedMailAttachment = { filename: string, content: Readable };