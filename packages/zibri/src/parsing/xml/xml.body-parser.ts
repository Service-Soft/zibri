import { XmlElementNode } from '../../document/xml-element-node.model';
import { XmlReaderUtilities } from '../../document/xml-reader.utilities';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { HttpRequest } from '../../http/http-request.model';
import { MimeType } from '../../http/mime-type.enum';
import { HttpClientResponse } from '../../http-client/http-client-response.model';
import { $ts } from '../../localization/translate.function';
import { XmlBodyMetadata } from '../../routing/decorators/body-metadata.model';
import { resolveMaxBodySize } from '../../routing/decorators/body.decorator';
import { optionalPeer } from '../../utilities/optional-peer.function';
import { WebsocketRequest } from '../../websocket/models/websocket-request.model';
import { BodyParserInterface } from '../body-parser.interface';
import { BodyParserUtilities } from '../body-parser.utilities';
import { BodyParser } from '../decorators/body-parser.decorator';
import { parseShape } from '../functions/parse-one-of.function';

/**
 * Body parser for xml.
 *
 * The root element is the body. A child element becomes the property of the same name, or the property marked
 * with `@XmlElement` of that name, and the elements a property declared as an array are all children of that name,
 * however many there are. A property marked with `@XmlAttribute`, `@XmlText` or `@XmlMixed` is read from that
 * attribute, from the element's own text or from everything inside the element instead.
 */
@BodyParser()
export class XmlBodyParser implements BodyParserInterface<MimeType.XML> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly contentType: MimeType.XML = MimeType.XML;

    constructor() {
        // at startup rather than at the first xml body, which would otherwise be answered with a 400
        // for invalid xml: parseXml cannot tell a parser that is missing from a document that is broken
        optionalPeer('saxes', 'The xml body parser');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    parseFromHttpClientResponse(res: HttpClientResponse, metadata: XmlBodyMetadata): unknown {
        if (res.body !== undefined) {
            return res.body;
        }
        return this.parseXml(res.rawBody, metadata);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    parseFromWebsocketRequest(req: WebsocketRequest, metadata: XmlBodyMetadata): unknown {
        return this.parseXml(req.body, metadata);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async parseFromHttpRequest(req: HttpRequest, metadata: XmlBodyMetadata): Promise<unknown> {
        if (req.body !== undefined) {
            return req.body;
        }
        const raw: Buffer = await BodyParserUtilities.readRequestBodyIntoMemory(req, resolveMaxBodySize(metadata));
        return this.parseXml(raw.length ? raw.toString('utf8') : undefined, metadata);
    }

    private parseXml(xml: unknown, metadata: XmlBodyMetadata): unknown {
        if (xml == undefined) {
            return undefined;
        }
        if (typeof xml !== 'string') {
            throw new BadRequestError($ts`an XML body has to be sent as text`);
        }
        try {
            const root: XmlElementNode = XmlReaderUtilities.resolveRootElement(xml);
            return parseShape(XmlReaderUtilities.readShape(root, metadata.shape), metadata.shape);
        }
        catch {
            throw new BadRequestError($ts`invalid XML in body`);
        }
    }
}