import { HttpRequest, MimeType } from '../http';
import { BodyMetadata } from '../routing';

export interface BodyParserInterface {
    readonly contentType: MimeType,
    parse: (req: HttpRequest, bodyMetadata: BodyMetadata) => Promise<unknown>
}