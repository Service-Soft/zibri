import { XmlElementNode } from '../../document/xml-element-node.model.ts';
import { XmlReaderUtilities } from '../../document/xml-reader.utilities.ts';
import { BadRequestError } from '../../error-handling/errors/bad-request.error.ts';
import { HttpRequest } from '../../http/http-request.model.ts';
import { MimeType } from '../../http/mime-type.enum.ts';
import { HttpClientResponse } from '../../http-client/http-client-response.model.ts';
import { $ts } from '../../localization/translate.function.ts';
import { XmlBodyMetadata } from '../../routing/decorators/body-metadata.model.ts';
import { resolveMaxBodySize } from '../../routing/decorators/body.decorator.ts';
import { optionalPeer } from '../../utilities/optional-peer.function.ts';
import { WebsocketRequest } from '../../websocket/models/websocket-request.model.ts';
import { BodyParserInterface } from '../body-parser.interface.ts';
import { BodyParserUtilities } from '../body-parser.utilities.ts';
import { BodyParser } from '../decorators/body-parser.decorator.ts';
import { parseShape } from '../functions/parse-one-of.function.ts';

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
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly contentType: MimeType.XML = MimeType.XML;

    constructor() {
        // at startup rather than at the first xml body, which would otherwise be answered with a 400
        // for invalid xml: parseXml cannot tell a parser that is missing from a document that is broken
        optionalPeer('saxes', 'The xml body parser');
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    parseFromHttpClientResponse(res: HttpClientResponse, metadata: XmlBodyMetadata): unknown {
        if (res.body !== undefined) {
            return res.body;
        }
        return this.parseXml(res.rawBody, metadata);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    parseFromWebsocketRequest(req: WebsocketRequest, metadata: XmlBodyMetadata): unknown {
        return this.parseXml(req.body, metadata);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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
            // read all the same, so a raw body is as well formed as any other
            if (metadata.raw) {
                return xml;
            }
            return parseShape(XmlReaderUtilities.readShape(root, metadata.shape), metadata.shape);
        }
        catch {
            throw new BadRequestError($ts`invalid XML in body`);
        }
    }
}