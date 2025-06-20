import { ZibriApplication } from '../application';
import { HttpRequest, MimeType } from '../http';
import { BodyMetadata } from '../routing';

export interface BodyParserInterface {
    readonly contentType: MimeType,
    attachTo?: (app: ZibriApplication) => Promise<void> | void,
    parse: (req: HttpRequest, bodyMetadata: BodyMetadata) => Promise<unknown>
}