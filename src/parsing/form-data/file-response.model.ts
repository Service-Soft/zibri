import path from 'path';
import { Readable } from 'stream';

import { LooseMimeType } from '../../http';
import { fileExistsSync, resolveMimeType } from '../../utilities';

type BaseFileResponseData = { mimeType?: LooseMimeType, forceDownload?: boolean };

type FileResponseData = BaseFileResponseData & { path: string }
    | BaseFileResponseData & { data: Buffer | Readable, filename: `${string}.${string}` };

export class FileResponse {
    readonly data: Buffer | Readable | string;
    readonly filename: `${string}.${string}`;
    readonly mimeType: LooseMimeType;
    readonly forceDownload: boolean;

    constructor(data: FileResponseData) {
        if ('path' in data) {
            this.data = data.path;
            this.filename = path.basename(data.path) as `${string}.${string}`;
        }
        else {
            this.data = data.data;
            this.filename = data.filename;
        }

        this.mimeType = data.mimeType ?? resolveMimeType(this.filename);
        this.forceDownload = data.forceDownload ?? false;
        this.validate();
    }

    private validate(): void {
        if (typeof this.data === 'string' && !fileExistsSync(this.data)) {
            throw new Error(`the file at path "${this.data}" does not exist.`);
        }
        if (!this.filename.includes('.')) {
            throw new Error('the file name does not include a file extension.');
        }
    }
}