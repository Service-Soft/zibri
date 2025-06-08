import { HttpRequest, MimeType } from '../http';

export interface BodyParserInterface {
    readonly contentType: MimeType,
    parse: (req: HttpRequest) => Promise<unknown>
}