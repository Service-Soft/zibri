import { WriteStream } from 'node:fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { Busboy, BusboyFileStream } from '@fastify/busboy';

import { FormDataBodyParserCleanupCronJob } from './form-data-body-parser-cleanup.cron-job';
import { FormData, FormDataValue } from './form-data.model';
import { ZibriApplication } from '../../application';
import { inject } from '../../di/inject.function';
import { OnAppInit } from '../../global/on-app-init.interface';
import { HttpRequest } from '../../http/http-request.model';
import { MimeType } from '../../http/mime-type.enum';
import { BodyMetadata } from '../../routing/decorators/body.decorator';
import { BodyParserInterface } from '../body-parser.interface';
import { File } from './file.model';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { Relation } from '../../entity/models/relation.enum';
import { ContentTooLargeError } from '../../error-handling/errors/content-too-large.error';
import { KnownHeader } from '../../http/known-header.enum';
import { FileExtension, resolveFileExtension } from '../../http/mime-type.helpers';
import { HttpClientResponse } from '../../http-client/http-client-response.model';
import { BigNumberUtilities } from '../../utilities/big-number.utilities';
import { FsUtilities, FsPath } from '../../utilities/fs.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { BodyParser } from '../decorators/body-parser.decorator';
import { parseArray } from '../functions/parse-array.function';
import { parseBoolean } from '../functions/parse-boolean.function';
import { parseDate } from '../functions/parse-date.function';
import { parseNumber } from '../functions/parse-number.function';
import { parseObject } from '../functions/parse-object.function';
import { parseString } from '../functions/parse-string.function';

// eslint-disable-next-line jsdoc/require-jsdoc
type ParsedForm = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    fields: Record<string, string | string[]>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    filesMap: Record<string, File[]>
};

/**
 * Body parser for form data.
 */
@BodyParser()
export class FormDataBodyParser implements BodyParserInterface, OnAppInit {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly contentType: MimeType = MimeType.FORM_DATA;

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        app.options.cronJobs.push(FormDataBodyParserCleanupCronJob);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    parseFromWebsocketRequest(): unknown {
        throw new Error('A form data body cannot be used with websocket requests');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async parseFromHttpRequest(req: HttpRequest, metadata: BodyMetadata): Promise<unknown> {
        return await this.parseFromBody(req.body, metadata, req.headers, req);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async parseFromHttpClientResponse(
        res: HttpClientResponse,
        metadata: BodyMetadata
    ): Promise<unknown> {
        return await this.parseFromBody(res.body, metadata, res.headers, res.rawBody as Readable);
    }

    private async parseFromBody(
        body: unknown,
        metadata: BodyMetadata,
        headers: Partial<Record<string, string | undefined>>,
        stream: Readable
    ): Promise<unknown> {
        if (body !== undefined) {
            return body as FormData<typeof metadata.modelClass>;
        }
        if (metadata.type !== MimeType.FORM_DATA) {
            throw new Error(`${metadata.type} is not supported`);
        }
        const contentLength: string | undefined = headers[KnownHeader.CONTENT_LENGTH] ?? headers[KnownHeader.CONTENT_LENGTH];
        if (contentLength && BigNumberUtilities.new(Number(contentLength)).isGreaterThan(metadata.maxSize)) {
            throw new ContentTooLargeError();
        }

        const tempFolder: FsPath = this.getTempFolder();

        try {
            const parsed: ParsedForm = await this.parseMultipartStreamToDisk(stream, headers, tempFolder, metadata);
            const formDataValue: typeof metadata.modelClass = this.requestToDataObject(parsed, metadata);
            const formData: FormData<typeof metadata.modelClass> = await FormData.create(
                formDataValue,
                tempFolder,
                metadata.cleanupAfterMs
            );
            return formData;
        }
        catch (error) {
            // Clean up files on error
            await this.removeTempFolder(tempFolder);
            throw error;
        }
    }

    private getTempFolder(): FsPath {
        const tempPath: FsPath = inject(ZIBRI_DI_TOKENS.FILE_UPLOAD_TEMP_FOLDER);
        return FsUtilities.getPath(tempPath, `temp-${UUIDUtilities.generate()}`);
    }

    private getTempFileName(mimetype: string): string {
        const id: string = UUIDUtilities.generate();
        const ext: FileExtension | undefined = resolveFileExtension(mimetype);
        if (ext) {
            return `${id}${ext}`;
        }
        return id;
    }

    private async removeTempFolder(tempFolder: FsPath): Promise<void> {
        try {
            await FsUtilities.rm(tempFolder);
        }
        catch {
            // Do nothing
        }
    }

    private requestToDataObject<T extends object>(request: ParsedForm, metadata: BodyMetadata): T {
        const multiPartMap: Map<keyof T, FormDataValue> = new Map();
        this.addStringValuesToMap(request, multiPartMap);
        this.addFilesToMap<T>(request, multiPartMap, metadata);

        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(metadata.modelClass);
        const res: Partial<Record<keyof T, unknown>> = {};
        for (const [key, value] of multiPartMap) {
            if (typeof value !== 'string') {
                res[key] = value;
                continue;
            }

            const propertyMetadata: PropertyMetadata = properties[key as string];
            switch (propertyMetadata.type) {
                case 'string': {
                    res[key] = parseString(value);
                    break;
                }
                case 'number': {
                    res[key] = parseNumber(value);
                    break;
                }
                case 'boolean': {
                    res[key] = parseBoolean(value);
                    break;
                }
                case 'object': {
                    res[key] = parseObject(value, propertyMetadata.cls());
                    break;
                }
                case 'array': {
                    res[key] = parseArray(value, propertyMetadata.items);
                    break;
                }
                case 'date': {
                    res[key] = parseDate(value);
                    break;
                }
                case Relation.ONE_TO_ONE:
                case Relation.ONE_TO_MANY:
                case Relation.MANY_TO_ONE:
                case Relation.MANY_TO_MANY:
                case 'file':
                case 'unknown': {
                    res[key] = value;
                    break;
                }
            }
        }
        return res as T;
    }

    private addFilesToMap<T extends object>(
        request: ParsedForm,
        values: Map<keyof T, FormDataValue>,
        metadata: BodyMetadata
    ): void {
        for (const key in request.filesMap) {
            const formDataProperties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(metadata.modelClass);
            const property: PropertyMetadata = formDataProperties[key];
            this.addFileArrayToMap(request.filesMap[key], values, property);
        }
    }

    private addFileArrayToMap<T extends object>(
        rawFiles: File[],
        values: Map<keyof T, FormDataValue>,
        propertyMetadata: PropertyMetadata
    ): void {
        for (const file of rawFiles) {
            this.addSingleFileToMap(file, values, propertyMetadata);
        }
    }

    private addSingleFileToMap<T extends object>(
        rawFile: File,
        values: Map<keyof T, FormDataValue>,
        propertyMetadata: PropertyMetadata
    ): void {
        const existingValue: FormDataValue | undefined = values.get(rawFile.fieldname as keyof T);
        if (typeof existingValue === 'string') {
            throw new Error('Your form-data contains files and strings for the same key.');
        }
        const file: File = new File(rawFile);
        if (existingValue == undefined) {
            if (propertyMetadata.type === 'array') {
                values.set(file.fieldname as keyof T, [file]);
                return;
            }
            values.set(file.fieldname as keyof T, file);
            return;
        }
        if (Array.isArray(existingValue)) {
            existingValue.push(file);
            return;
        }
        values.set(file.fieldname as keyof T, [existingValue, file]);
    }

    private addStringValuesToMap<T extends object>(request: ParsedForm, values: Map<keyof T, FormDataValue>): void {
        if (request.fields == undefined || typeof request.fields !== 'object') {
            return;
        }
        for (const key in request.fields) {
            values.set(key as keyof T, (request.fields as Record<string, string>)[key]);
        }
    }

    private async parseMultipartStreamToDisk(
        stream: Readable,
        headers: Partial<Record<string, string | undefined>>,
        tempFolder: FsPath,
        metadata: BodyMetadata
    ): Promise<ParsedForm> {
        const contentType: string | undefined = headers[KnownHeader.CONTENT_TYPE]
            ?? headers[KnownHeader.CONTENT_TYPE.toLowerCase()];

        await FsUtilities.mkdir(tempFolder);

        return await new Promise<ParsedForm>((resolve, reject) => {
            const bb: Busboy = Busboy({ headers: { 'content-type': contentType ?? 'string' } });

            const fields: Record<string, string | string[]> = {};
            const filesMap: Record<string, File[]> = {};
            const filePromises: Promise<void>[] = [];

            let received: BigNumber = BigNumberUtilities.new(0);
            let aborted: boolean = false;

            bb.on('field', (name: string, val: string) => {
                if (aborted) {
                    return;
                }

                const bytes: number = Buffer.byteLength(val, 'utf8');
                received = BigNumberUtilities.add(received, bytes);
                if (received.isGreaterThan(metadata.maxSize)) {
                    aborted = true;
                    // stop parsing and abort
                    stream.unpipe(bb);
                    bb.destroy(new ContentTooLargeError());
                    // surface a nice error to caller
                    reject(new ContentTooLargeError());
                    return;
                }

                if (Object.prototype.hasOwnProperty.call(fields, name)) {
                    const cur: string | string[] = fields[name];
                    if (Array.isArray(cur)) {
                        cur.push(val);
                    }
                    else {
                        fields[name] = [cur, val];
                    }
                }
                else {
                    fields[name] = val;
                }
            });

            bb.on('file', (fieldname: string, fileStream: BusboyFileStream, originalname: string, _: string, mimetype: string) => {
                const filename: string = this.getTempFileName(mimetype);
                const destination: FsPath = FsUtilities.getPath(tempFolder, filename);
                const writeStream: WriteStream = FsUtilities.createWriteStream(destination);
                let size: number = 0;

                fileStream.on('data', (chunk: Buffer) => {
                    if (aborted) {
                        return;
                    }

                    received = BigNumberUtilities.add(received, chunk.length);
                    if (received.isGreaterThan(metadata.maxSize)) {
                        aborted = true;
                        writeStream.destroy();
                        stream.unpipe(bb);
                        bb.destroy(new ContentTooLargeError());
                        stream.destroy(new ContentTooLargeError());
                        reject(new ContentTooLargeError());
                        return;
                    }

                    size += chunk.length;
                });

                fileStream.on('error', (err) => {
                    writeStream.destroy();
                    if (!aborted) {
                        reject(err);
                    }
                });

                writeStream.on('error', (err) => {
                    fileStream.resume();
                    if (!aborted) {
                        reject(err);
                    }
                });

                writeStream.on('finish', () => {
                    if (aborted) {
                        return;
                    }
                    const meta: File = {
                        fieldname,
                        filename,
                        destination: tempFolder,
                        originalname,
                        mimetype,
                        size,
                        path: destination
                    };
                    filesMap[fieldname] = filesMap[fieldname] ?? [];
                    filesMap[fieldname].push(meta);
                });

                filePromises.push(pipeline(fileStream, writeStream).catch(error => {
                    if (!aborted) {
                        reject(error);
                    }
                }));
            });

            bb.on('finish', () => {
                try {
                    void Promise.all(filePromises).then(() => resolve({ fields, filesMap }));
                }
                catch (error) {
                    reject(error);
                }
            });
            bb.on('error', (err) => reject(err));

            stream.pipe(bb);
        });
    }
}