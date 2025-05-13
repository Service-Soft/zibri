import { Request } from 'express';

import { MimeType } from '../http';

export interface BodyParserInterface {
    readonly contentType: MimeType,
    parse: (req: Request) => Promise<unknown>
}