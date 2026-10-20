import { Transform } from 'node:stream';
import { constants, createBrotliCompress, createGzip } from 'node:zlib';

import { RequestHandler } from 'express';

import { HttpMethod } from './http-method.enum.ts';
import { HttpResponse } from './http-response.model.ts';
import { HttpStatus } from './http-status.enum.ts';
import { KnownHeader } from './known-header.enum.ts';
import { isCompressibleMimeType } from './mime-type.helpers.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';

/**
 * What a response may be encoded with.
 *
 * Deflate is deliberately absent: it is ambiguous about whether it carries a zlib header, and
 * clients disagree about which one they meant by it.
 */
type ContentEncoding = 'br' | 'gzip';

/**
 * Whether responses are compressed on the way out, and from what size on.
 */
export type CompressionOptions = {
    /**
     * Whether to compress at all.
     *
     * Turn it off where something in front of the application already does it - the work then happens
     * on a machine that has nothing else to do, rather than on the thread pool this process also
     * hashes passwords with.
     */
    enabled: boolean,
    /**
     * The size from which a response is worth compressing.
     *
     * Below it an encoded body tends to be no smaller, and the header it needs makes it larger. A
     * response whose length is not known ahead of time - anything streamed - is always compressed.
     */
    thresholdInBytes: number
};

/**
 * A cache-control that forbids changing the body, which is what encoding it is.
 */
const NO_TRANSFORM: RegExp = /(?:^|,)\s*no-transform\s*(?:,|$)/i;

/**
 * The encoding to use for a client that asked for these, if any.
 *
 * Brotli first: at the quality dynamic content is worth spending it is smaller than gzip for
 * comparable cpu, and a client offering both has already said it can read either.
 * @param header - The accept-encoding of the request.
 * @returns What to encode with, or undefined when the client asked for nothing this can produce.
 */
function negotiateEncoding(header: string | string[] | undefined): ContentEncoding | undefined {
    const weights: Map<string, number> = new Map();
    for (const entry of (Array.isArray(header) ? header.join(',') : header ?? '').split(',')) {
        const [name, ...parameters]: string[] = entry.trim().toLowerCase()
            .split(';');
        if (!name) {
            continue;
        }
        const quality: string | undefined = parameters
            .map(p => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1])
            .find(q => q != undefined);
        weights.set(name, quality == undefined ? 1 : Number(quality));
    }

    // a client sending `*` accepts anything it did not name - including nothing at all, when it
    // weighted the wildcard zero
    const weightOf: (encoding: ContentEncoding) => number = encoding => weights.get(encoding) ?? weights.get('*') ?? 0;
    if (weightOf('br') > 0) {
        return 'br';
    }
    return weightOf('gzip') > 0 ? 'gzip' : undefined;
}

/**
 * Whether this response is one worth encoding, judged once its headers are known.
 * @param res - The response about to be written.
 * @param thresholdInBytes - The size from which compressing is worth it.
 * @returns True when the body should be encoded.
 */
function isWorthCompressing(res: HttpResponse, thresholdInBytes: number): boolean {
    if (res.getHeader(KnownHeader.CONTENT_ENCODING) != undefined) {
        // already encoded by whatever produced it, and encoding it twice is only ever worse
        return false;
    }
    if (res.statusCode === HttpStatus.NO_CONTENT || res.statusCode === HttpStatus.NOT_MODIFIED) {
        return false;
    }
    if (NO_TRANSFORM.test(String(res.getHeader(KnownHeader.CACHE_CONTROL) ?? ''))) {
        return false;
    }
    if (!isCompressibleMimeType(String(res.getHeader(KnownHeader.CONTENT_TYPE) ?? ''))) {
        return false;
    }
    const length: number = Number(res.getHeader(KnownHeader.CONTENT_LENGTH) ?? Number.NaN);
    // a body of unknown length is a streamed one, which is where the saving is largest
    return Number.isNaN(length) || length >= thresholdInBytes;
}

/**
 * Compresses response bodies a client said it can read.
 *
 * It works by taking over `write` and `end` rather than by encoding where the framework produces a
 * body, and that buys two things. Everything answering a request goes through them - a route result,
 * a streamed file, the error handler, a middleware somebody added - and express computes the ETag
 * inside `send`, which runs before either, so the validator stays a fact about the body rather than
 * about the encoding it happened to be sent in.
 *
 * Nothing is decided until the first write, because until then the response has no content type and
 * no length to decide on.
 * @returns The middleware.
 */
export function compressionMiddleware(): RequestHandler {
    return (req, response, next) => {
        // read per request rather than when the middleware is built: this is registered while the
        // application is being constructed, and there is no container to ask until init has run
        const options: CompressionOptions = inject(ZIBRI_DI_TOKENS.COMPRESSION_OPTIONS);
        if (!options.enabled) {
            next();
            return;
        }
        const res: HttpResponse = response as HttpResponse;

        // set whether or not this response ends up encoded: a cache holding the plain answer must not
        // hand it to a client that only reads gzip, and this header is what tells it so
        res.vary(KnownHeader.ACCEPT_ENCODING);

        const encoding: ContentEncoding | undefined = negotiateEncoding(req.headers[KnownHeader.ACCEPT_ENCODING]);
        // a HEAD carries the headers of an answer and none of its body, so there is nothing to encode
        // and an empty gzip envelope would be a body it must not have
        if (encoding == undefined || req.method === HttpMethod.HEAD) {
            next();
            return;
        }

        const originalWrite: HttpResponse['write'] = res.write.bind(res);
        const originalEnd: HttpResponse['end'] = res.end.bind(res);
        let compressor: Transform | undefined;
        let decided: boolean = false;

        /**
         * Decides on the first write whether this body is encoded, and prepares the encoder if so.
         * @returns What to write the body to, or undefined to write it untouched.
         */
        function compressorFor(): Transform | undefined {
            if (decided) {
                return compressor;
            }
            decided = true;
            if (!isWorthCompressing(res, options.thresholdInBytes)) {
                return undefined;
            }

            res.setHeader(KnownHeader.CONTENT_ENCODING, encoding as string);
            // what the client was told to expect is the plain body, and it is not getting that one
            res.removeHeader(KnownHeader.CONTENT_LENGTH);

            // quality four rather than brotli's default of eleven, which is meant for a file that is
            // compressed once and served a million times. On a body built per request it costs far
            // more cpu than the bytes it saves are worth.
            compressor = encoding === 'br'
                ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
                : createGzip();

            compressor.on('data', (chunk: Buffer) => {
                if (!originalWrite(chunk)) {
                    // the socket is full, so stop producing until it drains. Without this a large
                    // response is held in memory as fast as zlib can encode it.
                    compressor?.pause();
                }
            });
            res.on('drain', () => compressor?.resume());
            // whatever is piping into the response stops when a write is refused and waits for the
            // response to say it may continue. Once the encoder is in between, a refused write is the
            // encoder being full rather than the socket, so the response has no drain of its own to
            // give and the one to pass on is the encoder's - without it a body longer than the
            // encoder holds at once stops partway and the request never ends.
            compressor.on('drain', () => res.emit('drain'));
            // ended here rather than where the handler called end, because the encoder is still
            // holding the tail of the body at that point
            compressor.on('end', () => originalEnd());
            return compressor;
        }

        res.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
            const stream: Transform | undefined = compressorFor();
            // eslint-disable-next-line typescript/no-unsafe-argument, typescript/no-explicit-any
            return stream ? stream.write(chunk) : originalWrite(chunk as any, ...rest as any);
        }) as HttpResponse['write'];

        res.end = ((chunk?: unknown, ...rest: unknown[]): HttpResponse => {
            const stream: Transform | undefined = compressorFor();
            if (!stream) {
                // eslint-disable-next-line typescript/no-unsafe-argument, typescript/no-explicit-any
                return originalEnd(chunk as any, ...rest as any) as HttpResponse;
            }
            // end takes a callback in place of a body, and a function is not one
            stream.end(typeof chunk === 'function' ? undefined : chunk);
            return res;
        }) as HttpResponse['end'];

        next();
    };
}