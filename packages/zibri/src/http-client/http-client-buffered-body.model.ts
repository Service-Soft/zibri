/**
 * What the body describes itself as, wherever it is written out as json.
 */
export type HttpClientBufferedBodyDescription = {
    /**
     * How many bytes it holds.
     */
    byteLength: number
};

/**
 * A request body held in memory as the chunks it was read in, sent as an `application/octet-stream`.
 *
 * The chunks are sent as they are, without being joined into one buffer or copied into a `Blob`
 * first, so the body is in memory once while it goes out. It is sent with its length, as a service
 * such as S3 requires of an upload, and whole again on every attempt and to wherever a redirect leads.
 */
export class HttpClientBufferedBody {
    /**
     * How many bytes it holds.
     */
    readonly byteLength: number;

    // eslint-disable-next-line jsdoc/require-description
    /**
     * @param chunks - The bytes, in the order they are sent. The body keeps the chunks themselves, and
     * a chunk changed while a request runs is sent changed.
     */
    constructor(private readonly chunks: Uint8Array[]) {
        this.byteLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    }

    /**
     * Creates a stream of the bytes, for one request.
     * @returns The stream.
     */
    createStream(): ReadableStream<Uint8Array> {
        let next: number = 0;
        return new ReadableStream<Uint8Array>({
            pull: controller => {
                const chunk: Uint8Array | undefined = this.chunks[next];
                next++;
                if (chunk == undefined) {
                    controller.close();
                    return;
                }
                controller.enqueue(chunk);
            }
        });
    }

    /**
     * Describes the body by its length.
     * @returns The description.
     */
    toJSON(): HttpClientBufferedBodyDescription {
        // the error of a refused request carries its body, and an error ends up in a log: the bytes,
        // a part of a backup say, have no place in one
        return { byteLength: this.byteLength };
    }
}