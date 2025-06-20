
import { rm } from 'fs/promises';
import path from 'path';

import { RequestHandler } from 'express';
import multer, { StorageEngine } from 'multer';
import { v4 } from 'uuid';

import { FileExtension, HttpRequest, HttpResponse, MimeType, resolveFileExtension } from '../../http';
import { BodyMetadata } from '../../routing';
import { BodyParserInterface } from '../body-parser.interface';
import { BodyParser } from '../decorators';
import { FormDataBodyParserCleanupCronJob } from './cleanup.cron-job';
import { File, MulterFile } from './file.model';
import { FormData, FormDataValue } from './form-data.model';
import { ZibriApplication } from '../../application';
import { inject, ZIBRI_DI_TOKENS } from '../../di';
import { PropertyMetadata } from '../../entity';
import { MetadataUtilities } from '../../utilities';

@BodyParser()
export class FormDataBodyParser implements BodyParserInterface {
    readonly contentType: MimeType = MimeType.FORM_DATA;

    attachTo(app: ZibriApplication): void {
        app['options'].cronJobs.push(FormDataBodyParserCleanupCronJob);
    }

    async parse(req: HttpRequest, metadata: BodyMetadata): Promise<FormData<object>> {
        if (req.body !== undefined) {
            return req.body as FormData<object>;
        }
        if (metadata.type !== MimeType.FORM_DATA) {
            throw new Error(`${metadata.type} is not supported`);
        }

        const tempPath: string = inject(ZIBRI_DI_TOKENS.FILE_UPLOAD_TEMP_FOLDER);
        const tempFolder: string = path.join(tempPath, `temp-${v4()}`);
        const storage: StorageEngine = multer.diskStorage({
            destination: tempFolder,
            // eslint-disable-next-line promise/prefer-await-to-callbacks
            filename: (_, file, callback) => {
                const id: string = v4();
                const ext: FileExtension | undefined = resolveFileExtension(file.mimetype);
                if (ext) {
                    // eslint-disable-next-line promise/prefer-await-to-callbacks, unicorn/no-null
                    callback(null, `${id}${ext}`);
                }
                // eslint-disable-next-line promise/prefer-await-to-callbacks, unicorn/no-null
                callback(null, id);
            }
        });
        const upload: RequestHandler = multer({ storage: storage }).any();

        return new Promise<FormData<object>>((resolve, reject) => {
            // eslint-disable-next-line typescript/no-misused-promises, promise/prefer-await-to-callbacks
            void upload(req, {} as HttpResponse, async (err: unknown) => {
                if (err != undefined) {
                    await this.removeTempFolder(tempFolder);
                    reject(err);
                }
                if (req.body != undefined && typeof req.body !== 'object') {
                    await this.removeTempFolder(tempFolder);
                    reject('The request body is not an object');
                }
                try {
                    const formDataValue: object = this.requestToDataObject(req, metadata);
                    const formData: FormData<object> = await FormData.create(formDataValue, tempFolder, metadata.cleanupAfterMs);
                    // Update cleanup cron job.
                    resolve(formData);
                }
                catch (error) {
                    await this.removeTempFolder(tempFolder);
                    reject(error);
                }

            });
        });
    }

    private async removeTempFolder(tempFolder: string): Promise<void> {
        try {
            await rm(tempFolder, { recursive: true });
        }
        catch {
            // Do nothing
        }
    }

    private requestToDataObject<T extends object>(request: HttpRequest, metadata: BodyMetadata): T {
        const multiPartMap: Map<keyof T, FormDataValue> = new Map();
        this.addStringValuesToMap(request, multiPartMap);
        this.addFilesToMap<T>(request, multiPartMap, metadata);

        const res: Partial<Record<keyof T, T[keyof T]>> = {};
        for (const [key, value] of multiPartMap) {
            try {
                // eslint-disable-next-line typescript/no-unsafe-assignment
                res[key] = JSON.parse(value as string);
            }
            catch {
                res[key] = value as T[keyof T];
                // throw new HttpErrors.BadRequest(`The provided form-data value "${String(key)}" is neither a file nor valid JSON.`);
            }
        }
        return res as T;
    }

    private addFilesToMap<T extends object>(
        request: HttpRequest,
        values: Map<keyof T, FormDataValue>,
        metadata: BodyMetadata
    ): void {
        if (!request.files) {
            return;
        }

        if (Array.isArray(request.files)) {
            for (const file of request.files) {
                const formDataProperties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(metadata.modelClass);
                const property: PropertyMetadata = formDataProperties[file.fieldname];
                this.addSingleFileToMap(file, values, property);
            }
            return;
        }

        for (const key in request.files) {
            this.addFileArrayToMap(key, request.files[key], values);
        }
    }

    private addFileArrayToMap<T extends object>(key: string, multerFiles: MulterFile[], values: Map<keyof T, FormDataValue>): void {
        const existingValue: FormDataValue = values.get(key as keyof T);
        if (typeof existingValue === 'string') {
            throw new Error('Your form-data contains files and strings for the same key.');
        }
        const files: File[] = multerFiles.map(f => new File(f));
        if (existingValue == undefined) {
            values.set(key as keyof T, files);
            return;
        }
        if (Array.isArray(existingValue)) {
            existingValue.push(...files);
            return;
        }
        values.set(key as keyof T, [existingValue, ...files]);
    }

    private addSingleFileToMap<T extends object>(
        multerFile: MulterFile,
        values: Map<keyof T, FormDataValue>,
        propertyMetadata: PropertyMetadata
    ): void {
        const existingValue: FormDataValue | undefined = values.get(multerFile.fieldname as keyof T);
        if (typeof existingValue === 'string') {
            throw new Error('Your form-data contains files and strings for the same key.');
        }
        const file: File = new File(multerFile);
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

    private addStringValuesToMap<T extends object>(request: HttpRequest, values: Map<keyof T, FormDataValue>): void {
        if (request.body == undefined) {
            return;
        }
        for (const key in request.body) {
            // eslint-disable-next-line typescript/no-unsafe-member-access
            values.set(key as keyof T, request.body[key] as string);
        }
    }
}