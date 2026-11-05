import { Readable } from 'node:stream';

/**
 * What a container wrote, kept so that a test whose container failed can say why.
 */
export class ContainerOutput {
    private readonly chunks: string[] = [];

    /**
     * Keeps what the container writes. Hand it to `withLogConsumer`.
     * @param stream - The container's output.
     */
    readonly consume: (stream: Readable) => void = stream => {
        stream.on('data', (chunk: Buffer | string) => this.chunks.push(chunk.toString()));
    };

    /**
     * An error saying what went wrong, followed by what the container wrote until then.
     * @param error - What went wrong.
     * @returns The error.
     */
    explain(error: unknown): Error {
        const message: string = error instanceof Error ? error.message : String(error);
        return new Error(`${message}\n\nWhat the container wrote:\n${this.chunks.join('')}`, { cause: error });
    }
}