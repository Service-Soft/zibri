import { WriteStream } from 'node:fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import type { BusboyFileStream, BusboyInstance } from '@fastify/busboy';

import { FormDataBodyParserCleanupCronJob } from './form-data-body-parser-cleanup.cron-job.ts';
import { FormDataLimits } from './form-data-limits.model.ts';
import { FormData, FormDataValue } from './form-data.model.ts';
import { ZibriApplication } from '../../application/application.ts';
import { inject } from '../../di/inject.function.ts';
import { BadRequestError } from '../../error-handling/errors/bad-request.error.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { OnAppInit } from '../../global/on-app-init.interface.ts';
import { HttpRequest } from '../../http/http-request.model.ts';
import { MimeType } from '../../http/mime-type.enum.ts';
import { HttpClientResponse } from '../../http-client/http-client-response.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { shapeProblems } from '../../validation/functions/shape-problems.function.ts';
import { BodyParserInterface } from '../body-parser.interface.ts';
import { File } from './file.model.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { ContentTooLargeError } from '../../error-handling/errors/content-too-large.error.ts';
import { KnownHeader } from '../../http/known-header.enum.ts';
import { FileExtension, resolveFileExtension } from '../../http/mime-type.helpers.ts';
import { $ts } from '../../localization/translate.function.ts';
import { BodyShapeMetadata, FormDataBodyMetadata } from '../../routing/decorators/body-metadata.model.ts';
import { resolveMaxBodySize } from '../../routing/decorators/body.decorator.ts';
import { FsUtilities, FsPath } from '../../utilities/fs.utilities.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { BigNumber, NumberUtilities } from '../../utilities/number.utilities.ts';
import { ObjectUtilities } from '../../utilities/object.utilities.ts';
import { optionalPeer } from '../../utilities/optional-peer.function.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { BodyParser } from '../decorators/body-parser.decorator.ts';
import { parseFormField } from '../functions/parse-form-field.function.ts';

// eslint-disable-next-line jsdoc-js/require-jsdoc
type ParsedForm = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    fields: Record<string, string | string[]>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    filesMap: Record<string, File[]>
};

/**
 * Whether a value of a form is the texts of a field sent more than once, rather than files.
 * @param value - The value.
 * @returns True for a list of texts.
 */
function isTextList(value: FormDataValue): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}

/**
 * Body parser for form data. Only works with http requests.
 */
@BodyParser()
export class FormDataBodyParser implements BodyParserInterface<MimeType.FORM_DATA>, OnAppInit {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly contentType: MimeType.FORM_DATA = MimeType.FORM_DATA;

    // eslint-disable-next-line sonarjs/no-duplicate-string
    private get busboy(): typeof import('@fastify/busboy') {
        return optionalPeer<typeof import('@fastify/busboy')>('@fastify/busboy', 'Default FormData body parser of Zibri');
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        if (!app.options.cronJobs.includes(FormDataBodyParserCleanupCronJob)) {
            app.options.cronJobs.push(FormDataBodyParserCleanupCronJob);
        }

        optionalPeer('@fastify/busboy', 'Default FormData body parser of Zibri');
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    parseFromWebsocketRequest(): unknown {
        throw new InternalError('A form data body cannot be used with websocket requests');
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async parseFromHttpRequest(req: HttpRequest, metadata: FormDataBodyMetadata): Promise<unknown> {
        return await this.parseFromBody(req.body, metadata, req.headers, req);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async parseFromHttpClientResponse(
        res: HttpClientResponse,
        metadata: FormDataBodyMetadata
    ): Promise<unknown> {
        return await this.parseFromBody(res.body, metadata, res.headers, res.rawBody as Readable);
    }

    private async parseFromBody(
        body: unknown,
        metadata: FormDataBodyMetadata,
        headers: Partial<Record<string, string | undefined>>,
        stream: Readable
    ): Promise<unknown> {
        if (body !== undefined) {
            return body;
        }
        const contentLength: string | undefined = headers[KnownHeader.CONTENT_LENGTH];
        if (contentLength && NumberUtilities.new(Number(contentLength)).isGreaterThan(resolveMaxBodySize(metadata))) {
            throw new ContentTooLargeError();
        }

        const tempFolder: FsPath = this.getTempFolder();

        try {
            const parsed: ParsedForm = await this.parseMultipartStreamToDisk(stream, headers, tempFolder, metadata);
            const formDataValue: object = this.requestToValue(parsed, metadata.shape);
            const formData: FormData<object> = await FormData.create(
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

    /**
     * Reads a form as the class, or the first of several classes, it is declared as.
     *
     * Which fields are files, and which of those are lists, is read off a class - so a form that can be
     * one of several is read as each in order and becomes the first that it fits.
     * @param request - The fields and files the form carried.
     * @param shape - What the form is declared as.
     * @returns The value of the form.
     * @throws When the form is declared as something other than a class, or several classes.
     */
    private requestToValue(request: ParsedForm, shape: BodyShapeMetadata): object {
        switch (shape.type) {
            case 'object': {
                return this.requestToDataObject(request, shape.cls());
            }
            case 'anyOf': {
                const candidates: object[] = [];
                for (const candidate of shape.shapes) {
                    if (candidate.type !== 'object') {
                        throw new InternalError('Each shape of a form data body has to be a class.');
                    }
                    const value: object = this.requestToDataObject(request, candidate.cls());
                    if (!shapeProblems('', value, candidate).length) {
                        return value;
                    }
                    candidates.push(value);
                }
                // read as the first class when it fits none, so that validation reports every class
                // against what the form carried
                return candidates[0] ?? {};
            }
            case 'string':
            case 'number':
            case 'boolean':
            case 'date':
            case 'array':
            case 'unknown': {
                throw new InternalError('A form data body has to be a class, or one of several classes.');
            }
        }
    }

    private requestToDataObject<T extends object>(request: ParsedForm, cls: Newable<unknown>): T {
        const multiPartMap: Map<keyof T, FormDataValue> = new Map();
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        this.addStringValuesToMap(request, multiPartMap);
        this.addFilesToMap<T>(request, multiPartMap, properties);

        const res: Partial<Record<keyof T, unknown>> = {};
        for (const [key, value] of multiPartMap) {
            if (typeof value === 'string' || isTextList(value)) {
                // own properties only: a field named `constructor` would otherwise read a member of
                // every object as its property
                res[key] = parseFormField(value, Object.hasOwn(properties, key) ? properties[key as string] : undefined);
                continue;
            }
            res[key] = value;
        }
        return res as T;
    }

    private addFilesToMap<T extends object>(
        request: ParsedForm,
        values: Map<keyof T, FormDataValue>,
        properties: Record<string, PropertyMetadata>
    ): void {
        for (const [key, files] of ObjectUtilities.entries(request.filesMap)) {
            const property: PropertyMetadata | undefined = properties[key];
            if (property == undefined) {
                // a file field the model does not declare, which any caller is free to send. There
                // is no metadata to say whether it is one file or a list, so it goes on under its
                // own name and validation reports the unknown key - the same answer a json body
                // gets for one. Reading the type off nothing made it a 500 instead
                values.set(key as keyof T, files.map(f => new File(f)));
                continue;
            }
            this.addFileArrayToMap(files, values, property);
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
        if (typeof existingValue === 'string' || isTextList(existingValue)) {
            // a form anybody can send, so a 400 rather than a fault of the application
            throw new BadRequestError($ts`The form has both text and files under "${rawFile.fieldname}".`);
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
            values.set(key as keyof T, request.fields[key]);
        }
    }

    private async parseMultipartStreamToDisk(
        stream: Readable,
        headers: Partial<Record<string, string | undefined>>,
        tempFolder: FsPath,
        metadata: FormDataBodyMetadata
    ): Promise<ParsedForm> {
        const contentType: string | undefined = headers[KnownHeader.CONTENT_TYPE]
            ?? headers[KnownHeader.CONTENT_TYPE.toLowerCase()];

        await FsUtilities.mkdir(tempFolder);
        const maxSize: BigNumber = resolveMaxBodySize(metadata);

        // the application's limits, with whatever this body said for itself over the top. Resolved
        // here rather than in the decorator because a decorator runs at module load, long before
        // there is a container to ask.
        const limits: FormDataLimits = {
            ...inject(ZIBRI_DI_TOKENS.FORM_DATA_LIMITS),
            ...metadata.type === MimeType.FORM_DATA ? metadata.limits : undefined
        };

        return await new Promise<ParsedForm>((resolve, reject) => {
            const bb: BusboyInstance = new this.busboy.Busboy({
                headers: { 'content-type': contentType ?? 'string' },
                // a byte budget bounds the wrong thing on its own: every file part opens a write
                // stream while it is being received, so a hundred thousand one byte files stay under
                // any size limit and still exhaust the process's file descriptors
                limits: {
                    files: limits.maxFiles,
                    parts: limits.maxParts,
                    fields: limits.maxFields,
                    // the body's own budget rather than a limit of its own. Busboy caps a field at
                    // one megabyte by default and answers an oversized one by *truncating* it - the
                    // handler is then given a value that is not what was sent, with nothing raised.
                    // Set to the whole body it can never bite before the counter below refuses.
                    fieldSize: maxSize.toNumber()
                }
            });

            const fields: Record<string, string | string[]> = {};
            const filesMap: Record<string, File[]> = {};
            const filePromises: Promise<void>[] = [];

            let received: BigNumber = NumberUtilities.new(0);
            let aborted: boolean = false;

            /**
             * Stops parsing and answers the caller, without taking the connection down with it.
             *
             * The request stream is taken off the parser and left alone rather than destroyed.
             * Destroying it is what turned every refusal into an `ECONNRESET`: the client never saw
             * the status, could not tell "too large" from a dropped network, and retried. Node closes
             * the connection itself once the response has been written over a body nobody read.
             * @param error - What to answer with.
             */
            const abort: (error: ContentTooLargeError) => void = error => {
                if (aborted) {
                    return;
                }
                aborted = true;
                stream.unpipe(bb);
                bb.destroy(error);
                reject(error);
            };

            // busboy reports a limit by stopping and saying so, not by failing: past `files` it
            // simply stops emitting file parts. Left unhandled the body would parse as whatever
            // happened to fit, which is a truncated request answered as though it were complete.
            bb.on('filesLimit', () => abort(new ContentTooLargeError($ts`Too many files, at most ${limits.maxFiles} are accepted.`)));
            bb.on('partsLimit', () => abort(new ContentTooLargeError($ts`Too many parts, at most ${limits.maxParts} are accepted.`)));
            bb.on('fieldsLimit', () => abort(new ContentTooLargeError($ts`Too many fields, at most ${limits.maxFields} are accepted.`)));

            bb.on('field', (name: string, val: string, nameTruncated: boolean, valueTruncated: boolean) => {
                if (aborted) {
                    return;
                }

                // a truncated part is the one answer worse than a refused one: the handler would be
                // given a name or a value that is not what was sent, and nothing would say so. The
                // limits above are set so this cannot be reached, and it is checked anyway - the
                // alternative to raising it is trusting silence.
                if (nameTruncated || valueTruncated) {
                    abort(new ContentTooLargeError($ts`The field "${name}" is too large.`));
                    return;
                }

                const bytes: number = Buffer.byteLength(val, 'utf8');
                received = NumberUtilities.add(received, bytes);
                if (received.isGreaterThan(maxSize)) {
                    abort(new ContentTooLargeError());
                    return;
                }

                const cur: string | string[] | undefined = Object.prototype.hasOwnProperty.call(fields, name)
                    ? fields[name]
                    : undefined;
                if (cur != undefined) {
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

                    received = NumberUtilities.add(received, chunk.length);
                    if (received.isGreaterThan(maxSize)) {
                        writeStream.destroy();
                        abort(new ContentTooLargeError());
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