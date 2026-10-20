import { ContentTooLargeError } from '../error-handling/errors/content-too-large.error.ts';
import { HttpRequest } from '../http/http-request.model.ts';
import { KnownHeader } from '../http/known-header.enum.ts';
import { BigNumber, NumberUtilities } from '../utilities/number.utilities.ts';

/**
 * Utilities shared by the body parsers.
 */
export abstract class BodyParserUtilities {

    /**
     * Reads the whole body into memory, as long as it stays within the given size.
     * @param req - The request to read the body of.
     * @param maxSize - The most the body may weigh, in bytes.
     * @returns The body. Empty when the request has none.
     * @throws ContentTooLargeError when the body is larger than allowed.
     */
    static async readRequestBodyIntoMemory(req: HttpRequest, maxSize: BigNumber): Promise<Buffer> {
        const contentLength: string | undefined = req.headers[KnownHeader.CONTENT_LENGTH];
        if (contentLength && NumberUtilities.new(Number(contentLength)).isGreaterThan(maxSize)) {
            throw new ContentTooLargeError();
        }

        const chunks: Buffer[] = [];
        let received: BigNumber = NumberUtilities.new(0);

        await new Promise<void>((resolve, reject) => {
            // eslint-disable-next-line typescript-js/typedef
            const onData = (chunk: Buffer): void => {
                received = NumberUtilities.add(received, chunk.length);
                if (received.isGreaterThan(maxSize)) {
                    // eslint-disable-next-line no-use-before-define
                    cleanup();
                    // paused rather than destroyed. Destroying the request takes the socket with it,
                    // so the caller got an ECONNRESET instead of the 413 - it could not tell "too
                    // large" from a dropped network and retried. Node closes the connection itself
                    // once the response has been written over a body nobody finished reading.
                    req.pause();
                    reject(new ContentTooLargeError());
                    return;
                }
                chunks.push(chunk);
            };

            // eslint-disable-next-line typescript-js/typedef
            const onEnd = (): void => {
                // eslint-disable-next-line no-use-before-define
                cleanup();
                resolve();
            };

            // eslint-disable-next-line typescript-js/typedef
            const onError = (err: Error): void => {
                // eslint-disable-next-line no-use-before-define
                cleanup();
                reject(err);
            };

            // eslint-disable-next-line typescript-js/typedef
            const cleanup = (): void => {
                req.off('data', onData);
                req.off('end', onEnd);
                req.off('error', onError);
            };

            req.on('data', onData);
            req.on('end', onEnd);
            req.on('error', onError);
        });

        return Buffer.concat(chunks);
    }
}