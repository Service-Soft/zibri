import { stat } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';

import { inject, ZIBRI_DI_TOKENS } from '../../di';
import { LooseFileMimeType, resolveMimeType } from '../../http';
import { LoggerInterface } from '../../logging';
import { OmitStrict } from '../../types';
import { pathExists } from '../../utilities';

/**
 * Data shared by all FileResponses.
 */
type BaseFileResponseData = {
    /**
     * The mime type of the file returned.
     */
    mimeType?: LooseFileMimeType,
    /**
     * The size of the file to send in bytes.
     * Used to set the Content-Length header.
     */
    size?: number
};

/**
 * Data of a FileResponse that returns a file from a path.
 */
type PathFileResponseData = BaseFileResponseData & {
    /**
     * The path of the file to return.
     */
    path: string,
    /**
     * The name of the file to return.
     * Defaults to the last part of the provided path.
     */
    filename?: `${string}.${string}`
};

/**
 * Data of a file response that returns a file from a stream.
 */
type StreamFileResponseData = BaseFileResponseData & {
    /**
     * The stream that provides the file content.
     */
    stream: Readable,
    /**
     * The name of the file.
     */
    filename: `${string}.${string}`
};

/**
 * A file response.
 */
export class FileResponse {

    private constructor(
        readonly data: Readable | string,
        readonly filename: string,
        readonly mimeType: LooseFileMimeType,
        readonly size: number | undefined
    ) {}

    /**
     * Creates a new FileResponse from the given path and options.
     * @param p - The path of the file to return.
     * @param options - Additional options like file size.
     * @returns A new FileResponse.
     */
    static async fromPath(p: string, options?: OmitStrict<PathFileResponseData, 'path'>): Promise<FileResponse> {
        const fullPath: string = path.resolve(p);
        const fileName: string = options?.filename ?? path.basename(fullPath);
        const mimeType: string = options?.mimeType ?? resolveMimeType(fileName);

        if (!await pathExists(p)) {
            throw new Error(`the file at path "${p}" does not exist.`);
        }
        if (!fileName.includes('.') && options?.mimeType == undefined) {
            const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
            logger.warn('the file name does not include a extension and no mimetype was provided.');
        }

        const size: number = options?.size ?? (await stat(fullPath)).size;

        return new this(fullPath, fileName, mimeType, size);
    }

    /**
     * Creates a new FileResponse from the given input.
     * @param input - The input with the stream, file name etc.
     * @returns A new FileResponse.
     */
    static fromStream(input: StreamFileResponseData): FileResponse {
        const mimeType: string = input.mimeType ?? resolveMimeType(input.filename);
        return new this(input.stream, input.filename, mimeType, input.size);
    }
}