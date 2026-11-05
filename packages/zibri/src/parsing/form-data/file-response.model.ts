import { Readable } from 'stream';

import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { Property } from '../../entity/decorators/property.decorator';
import { InternalError } from '../../error-handling/internal-error.model';
import { ContentDisposition } from '../../http/content-disposition.function';
import { LooseFileMimeType, MimeType } from '../../http/mime-type.enum';
import { MimeTypeUtilities } from '../../http/mime-type.utilities';
import { LoggerInterface } from '../../logging/logger.interface';
import { OmitStrict } from '../../types/omit-strict.type';
import { SelfDescribing } from '../../types/self-describing.type';
import { FsUtilities, FsPath } from '../../utilities/fs.utilities';
import { buildCspOptions, CspOptions, CspOptionsInput } from '../html/csp-options.model';

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
    csp?: boolean | CspOptionsInput,
    /**
     * Whether the browser saves the file as a download, or shows it, such as a PDF or an image.
     * Defaults to 'attachment'.
     */
    disposition?: ContentDisposition
};

/**
 * Data of a FileResponse that returns a file from a path.
 */
export type PathFileResponseData = BaseFileResponseData & {
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
export type StreamFileResponseData = BaseFileResponseData & {
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
export class FileResponse implements SelfDescribing {

    // Written down rather than left to the prototype. Whatever decides that a handler returned a file
    // has to keep deciding it after the value has been somewhere that json is the only thing it could
    // be. A class is exactly what does not survive that trip: the values come back and the prototype
    // does not, so `instanceof` answers no for a response that is one. This does survive, because it
    // is a value.
    /**
     * What this is, as a value, so that it is still known after the response has been through json
     * and back. Not part of what a caller is answered with.
     */
    @Property.string({ exclude: true })
    readonly className: 'FileResponse' = 'FileResponse';

    private constructor(
        readonly data: Readable | string,
        readonly filename: string,
        readonly mimeType: LooseFileMimeType,
        readonly size: number | undefined,
        readonly csp: boolean | CspOptions,
        readonly disposition: ContentDisposition
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
        const mimeType: string = options?.mimeType ?? MimeTypeUtilities.resolveFromPath(fileName);

        if (!await FsUtilities.exists(p)) {
            throw new InternalError(`the file at path "${p}" does not exist.`);
        }
        if (!fileName.includes('.') && options?.mimeType == undefined) {
            const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
            logger.warn('the file name does not include a extension and no mimetype was provided.');
        }

        const size: number = options?.size ?? (await FsUtilities.stat(fullPath)).size;
        const csp: boolean | CspOptions = buildCspOptions(options?.csp, this.getDefaultCsp(mimeType));

        // a download unless asked otherwise: a file shown is rendered on this application's origin,
        // which for an uploaded html file is a page the uploader wrote
        return new this(fullPath, fileName, mimeType, size, csp, options?.disposition ?? 'attachment');
    }

    /**
     * Creates a new FileResponse from the given input.
     * @param input - The input with the stream, file name etc.
     * @returns A new FileResponse.
     */
    static fromStream(input: StreamFileResponseData): FileResponse {
        const mimeType: string = input.mimeType ?? MimeTypeUtilities.resolveFromPath(input.filename);
        const csp: boolean | CspOptions = buildCspOptions(input?.csp, this.getDefaultCsp(mimeType));
        return new this(input.stream, input.filename, mimeType, input.size, csp, input.disposition ?? 'attachment');
    }

    private static getDefaultCsp(mimeType: string): boolean | CspOptions {
        return mimeType === MimeType.SVG ? inject(ZIBRI_DI_TOKENS.DEFAULT_CSP_OPTIONS) : false;
    }
}

/**
 * Whether the given value is a file response.
 *
 * Judged by its `className`, so that a response that has been through json and back is still
 * recognized as one.
 * @param value - The value to judge.
 * @returns True when the value is a file response.
 */
export function isFileResponse(value: unknown): value is FileResponse {
    return typeof value === 'object' && value != undefined
        && (value as Partial<FileResponse>).className === 'FileResponse';
}