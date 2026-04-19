import { Readable } from 'stream';

import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { LooseFileMimeType, MimeType } from '../../http/mime-type.enum';
import { resolveMimeType } from '../../http/mime-type.helpers';
import { LoggerInterface } from '../../logging/logger.interface';
import { DeepPartial } from '../../types/deep-partial.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { FsUtilities, FsPath } from '../../utilities/fs.utilities';
import { buildCspOptions, CspOptions } from '../html/csp-options.model';

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
    size?: number,
    /**
     * The configuration for CSP headers.
     * Can either be false to not set any, true to set the default CSP headers or a custom configuration.
     */
    csp?: boolean | DeepPartial<CspOptions>
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
        readonly size: number | undefined,
        readonly csp: boolean | CspOptions
    ) {}

    /**
     * Creates a new FileResponse from the given path and options.
     * @param p - The path of the file to return.
     * @param options - Additional options like file size.
     * @returns A new FileResponse.
     */
    static async fromPath(p: FsPath, options?: OmitStrict<PathFileResponseData, 'path'>): Promise<FileResponse> {
        const fullPath: FsPath = FsUtilities.resolve(p);
        const fileName: string = options?.filename ?? FsUtilities.baseName(fullPath);
        const mimeType: string = options?.mimeType ?? resolveMimeType(fileName);

        if (!await FsUtilities.exists(p)) {
            throw new Error(`the file at path "${p}" does not exist.`);
        }
        if (!fileName.includes('.') && options?.mimeType == undefined) {
            const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
            await logger.warn('the file name does not include a extension and no mimetype was provided.');
        }

        const size: number = options?.size ?? (await FsUtilities.stat(fullPath)).size;
        const csp: boolean | CspOptions = buildCspOptions(options?.csp, this.getDefaultCsp(mimeType));

        return new this(fullPath, fileName, mimeType, size, csp);
    }

    /**
     * Creates a new FileResponse from the given input.
     * @param input - The input with the stream, file name etc.
     * @returns A new FileResponse.
     */
    static fromStream(input: StreamFileResponseData): FileResponse {
        const mimeType: string = input.mimeType ?? resolveMimeType(input.filename);
        const csp: boolean | CspOptions = buildCspOptions(input?.csp, this.getDefaultCsp(mimeType));
        return new this(input.stream, input.filename, mimeType, input.size, csp);
    }

    private static getDefaultCsp(mimeType: string): boolean | CspOptions {
        if (mimeType === MimeType.SVG) {
            return inject(ZIBRI_DI_TOKENS.DEFAULT_CSP_OPTIONS);
        }
        return false;
    }
}