import { stat } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';

import { inject, ZIBRI_DI_TOKENS } from '../../di';
import { LooseFileMimeType, resolveMimeType } from '../../http';
import { LoggerInterface } from '../../logging';
import { OmitStrict } from '../../types';
import { pathExists } from '../../utilities';

type BaseFileResponseData = { mimeType?: LooseFileMimeType };

type PathFileResponseData = BaseFileResponseData & { path: string, filename?: `${string}.${string}`, size?: number };
type StreamFileResponseData = BaseFileResponseData & { stream: Readable, filename: `${string}.${string}`, size?: number };

export class FileResponse {

    private constructor(
        readonly data: Readable | string,
        readonly filename: string,
        readonly mimeType: LooseFileMimeType,
        readonly size: number | undefined
    ) {}

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

    static fromStream(input: StreamFileResponseData): FileResponse {
        const mimeType: string = input.mimeType ?? resolveMimeType(input.filename);
        return new this(input.stream, input.filename, mimeType, input.size);
    }
}