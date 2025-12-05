import { BadRequestError, ContentTooLargeError } from '../../error-handling';
import { HttpRequest, KnownHeader, MimeType } from '../../http';
import { HttpClientResponse } from '../../http-client';
import { BodyMetadata } from '../../routing';
import { BigNumber, BigNumberUtilities } from '../../utilities';
import { WebsocketRequest } from '../../websocket';
import { BodyParserInterface } from '../body-parser.interface';
import { BodyParser } from '../decorators';

/**
 * Body parser for json.
 */
@BodyParser()
export class JsonBodyParser implements BodyParserInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly contentType: MimeType = MimeType.JSON;

    // eslint-disable-next-line jsdoc/require-jsdoc
    parseFromHttpClientResponse(res: HttpClientResponse): unknown {
        return res.rawBody;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    parseFromWebsocketRequest(req: WebsocketRequest): unknown {
        return req.body;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async parseFromHttpRequest(req: HttpRequest, metadata: BodyMetadata): Promise<unknown> {
        if (req.body !== undefined) {
            return req.body;
        }
        const contentLength: string | undefined = req.headers[KnownHeader.CONTENT_LENGTH] ?? req.headers[KnownHeader.CONTENT_LENGTH];
        if (contentLength && BigNumberUtilities.new(Number(contentLength)).isGreaterThan(metadata.maxSize)) {
            throw new ContentTooLargeError();
        }

        const chunks: Buffer[] = [];
        let received: BigNumber = BigNumberUtilities.new(0);

        await new Promise<void>((resolve, reject) => {
            // eslint-disable-next-line typescript/typedef
            const onData = (chunk: Buffer): void => {
                received = BigNumberUtilities.add(received, chunk.length);
                if (received.isGreaterThan(metadata.maxSize)) {
                    // eslint-disable-next-line typescript/no-use-before-define
                    cleanup();
                    req.destroy(new ContentTooLargeError());
                    reject(new ContentTooLargeError());
                    return;
                }
                chunks.push(chunk);
            };

            // eslint-disable-next-line typescript/typedef
            const onEnd = (): void => {
                // eslint-disable-next-line typescript/no-use-before-define
                cleanup();
                resolve();
            };

            // eslint-disable-next-line typescript/typedef
            const onError = (err: Error): void => {
                // eslint-disable-next-line typescript/no-use-before-define
                cleanup();
                reject(err);
            };

            // eslint-disable-next-line typescript/typedef
            const cleanup = (): void => {
                req.off('data', onData);
                req.off('end', onEnd);
                req.off('error', onError);
            };

            req.on('data', onData);
            req.on('end', onEnd);
            req.on('error', onError);
        });

        try {
            const raw: Buffer = Buffer.concat(chunks);
            return raw.length > 0 ? JSON.parse(raw.toString('utf8')) : undefined;
        }
        catch {
            throw new BadRequestError('invalid JSON in request body');
        }
    }
}