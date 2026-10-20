import { Readable, Transform } from 'node:stream';

import { ContentTooLargeError } from '../../error-handling/errors/content-too-large.error.ts';
import { UnsupportedMediaTypeError } from '../../error-handling/errors/unsupported-media-type.error.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { HttpRequest } from '../../http/http-request.model.ts';
import { KnownHeader } from '../../http/known-header.enum.ts';
import { MimeType } from '../../http/mime-type.enum.ts';
import { HttpClientResponse } from '../../http-client/http-client-response.model.ts';
import { StreamBodyMetadata } from '../../routing/decorators/body-metadata.model.ts';
import { BigNumber, NumberUtilities } from '../../utilities/number.utilities.ts';
import { BodyParserInterface } from '../body-parser.interface.ts';
import { BodyParser } from '../decorators/body-parser.decorator.ts';

/**
 * Body parser for octet streams.
 */
@BodyParser()
export class StreamBodyParser implements BodyParserInterface<MimeType.OCTET_STREAM> {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly contentType: MimeType.OCTET_STREAM = MimeType.OCTET_STREAM;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    parseFromHttpRequest(req: HttpRequest, bodyMetadata: StreamBodyMetadata): unknown {
        const contentLength: string | undefined = req.headers[KnownHeader.CONTENT_LENGTH];
        if (contentLength && NumberUtilities.new(Number(contentLength)).isGreaterThan(bodyMetadata.maxSize)) {
            throw new ContentTooLargeError();
        }
        return this.limitStream(req, bodyMetadata.maxSize);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    parseFromWebsocketRequest(): unknown {
        throw new UnsupportedMediaTypeError(MimeType.OCTET_STREAM);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    parseFromHttpClientResponse(res: HttpClientResponse, bodyMetadata: StreamBodyMetadata): unknown {
        if (res.body !== undefined) {
            return res.body;
        }
        if (!(res.rawBody instanceof Readable)) {
            throw new InternalError('Expected response body to be a stream');
        }
        const contentLength: string | undefined = res.headers[KnownHeader.CONTENT_LENGTH];
        if (contentLength && NumberUtilities.new(Number(contentLength)).isGreaterThan(bodyMetadata.maxSize)) {
            throw new ContentTooLargeError();
        }

        return this.limitStream(res.rawBody, bodyMetadata.maxSize);
    }

    private limitStream(stream: Readable, maxSize: StreamBodyMetadata['maxSize']): Readable {
        let received: BigNumber = NumberUtilities.new(0);

        const limitedStream: Transform = new Transform({
            // eslint-disable-next-line promise/prefer-await-to-callbacks
            transform: (chunk: unknown, encoding: BufferEncoding, callback): void => {
                const chunkSize: number = typeof chunk === 'string'
                    ? Buffer.byteLength(chunk, encoding)
                    : Buffer.byteLength(chunk as Uint8Array);

                received = NumberUtilities.add(received, chunkSize);

                if (received.isGreaterThan(maxSize)) {
                    stream.unpipe(limitedStream);
                    stream.pause();

                    // eslint-disable-next-line promise/prefer-await-to-callbacks
                    callback(new ContentTooLargeError());
                    return;
                }

                // eslint-disable-next-line promise/prefer-await-to-callbacks, unicorn/no-null
                callback(null, chunk);
            }
        });

        stream.pipe(limitedStream);

        return limitedStream;
    }
}