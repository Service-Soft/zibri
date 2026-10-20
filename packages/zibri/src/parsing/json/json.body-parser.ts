import { BadRequestError } from '../../error-handling/errors/bad-request.error.ts';
import { HttpRequest } from '../../http/http-request.model.ts';
import { MimeType } from '../../http/mime-type.enum.ts';
import { HttpClientResponse } from '../../http-client/http-client-response.model.ts';
import { $ts } from '../../localization/translate.function.ts';
import { JsonBodyMetadata } from '../../routing/decorators/body-metadata.model.ts';
import { resolveMaxBodySize } from '../../routing/decorators/body.decorator.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { WebsocketRequest } from '../../websocket/models/websocket-request.model.ts';
import { BodyParserInterface } from '../body-parser.interface.ts';
import { BodyParserUtilities } from '../body-parser.utilities.ts';
import { BodyParser } from '../decorators/body-parser.decorator.ts';
import { parseShape } from '../functions/parse-one-of.function.ts';

/**
 * Body parser for json.
 */
@BodyParser()
export class JsonBodyParser implements BodyParserInterface<MimeType.JSON> {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly contentType: MimeType.JSON = MimeType.JSON;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    parseFromHttpClientResponse(res: HttpClientResponse, metadata: JsonBodyMetadata): unknown {
        if (res.body !== undefined) {
            return res.body;
        }
        return parseShape(res.rawBody, metadata.shape);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    parseFromWebsocketRequest(req: WebsocketRequest, metadata: JsonBodyMetadata): unknown {
        return parseShape(req.body, metadata.shape);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async parseFromHttpRequest(req: HttpRequest, metadata: JsonBodyMetadata): Promise<unknown> {
        if (req.body !== undefined) {
            return req.body;
        }
        const raw: Buffer = await BodyParserUtilities.readRequestBodyIntoMemory(req, resolveMaxBodySize(metadata));

        try {
            if (!raw.length) {
                return undefined;
            }

            // read as json before it is read as a shape: a shape that is text would otherwise take
            // the json text itself as its value
            return parseShape(JsonUtilities.parse<unknown>(raw.toString('utf8')), metadata.shape);
        }
        catch {
            throw new BadRequestError($ts`invalid JSON in request body`);
        }
    }
}