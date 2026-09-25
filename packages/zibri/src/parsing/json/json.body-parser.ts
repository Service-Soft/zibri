import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { HttpRequest } from '../../http/http-request.model';
import { MimeType } from '../../http/mime-type.enum';
import { HttpClientResponse } from '../../http-client/http-client-response.model';
import { $ts } from '../../localization/translate.function';
import { JsonBodyMetadata } from '../../routing/decorators/body-metadata.model';
import { JsonUtilities } from '../../utilities/json.utilities';
import { WebsocketRequest } from '../../websocket/models/websocket-request.model';
import { BodyParserInterface } from '../body-parser.interface';
import { BodyParserUtilities } from '../body-parser.utilities';
import { BodyParser } from '../decorators/body-parser.decorator';
import { parseShape } from '../functions/parse-one-of.function';

/**
 * Body parser for json.
 */
@BodyParser()
export class JsonBodyParser implements BodyParserInterface<MimeType.JSON> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly contentType: MimeType.JSON = MimeType.JSON;

    // eslint-disable-next-line jsdoc/require-jsdoc
    parseFromHttpClientResponse(res: HttpClientResponse, metadata: JsonBodyMetadata): unknown {
        if (res.body !== undefined) {
            return res.body;
        }
        return parseShape(res.rawBody, metadata.shape);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    parseFromWebsocketRequest(req: WebsocketRequest, metadata: JsonBodyMetadata): unknown {
        return parseShape(req.body, metadata.shape);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async parseFromHttpRequest(req: HttpRequest, metadata: JsonBodyMetadata): Promise<unknown> {
        if (req.body !== undefined) {
            return req.body;
        }
        const raw: Buffer = await BodyParserUtilities.readRequestBodyIntoMemory(req, metadata.maxSize);

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