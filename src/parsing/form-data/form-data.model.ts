import { rm, writeFile } from 'fs/promises';
import path from 'path';

import { File } from './file.model';

/**
 * The raw value that a form-data property has.
 */
export type FormDataValue = string | File | File[] | undefined;

/**
 * The name of the file that contains information about when a uploaded file should be cleaned up.
 */
export const CLEANUP_AT_FILE_NAME: string = '.cleanupAt';

/**
 * The result when parsing multipart/form-data request bodies.
 * Has a resolved object with all the request bodies values on their respective keys.
 */
export class FormData<FormDataType extends object> {

    /**
     * The resolved value as an object, containing all files and values correctly typed.
     */
    readonly value: FormDataType;

    /**
     * The temporary folder where all files are cached.
     * Should be deleted after you handled the form data with the cleanup method.
     */
    readonly tempFolder: string;

    private constructor(value: FormDataType, tempFolder: string) {
        this.value = value;
        this.tempFolder = tempFolder;
    }

    static async create<FormDataType extends object>(
        value: FormDataType,
        tempFolder: string,
        cleanupAfterMs: number
    ): Promise<FormData<FormDataType>> {
        const res: FormData<FormDataType> = new this(value, tempFolder);
        await writeFile(
            path.join(res.tempFolder, CLEANUP_AT_FILE_NAME),
            `${Date.now() + cleanupAfterMs}`,
            { encoding: 'utf8' }
        );
        return res;
    }

    /**
     * Deletes all temporary files belonging to this form data.
     */
    async cleanup(): Promise<void> {
        try {
            await rm(this.tempFolder, { recursive: true });
        }
        catch {
            // do nothing
        }
    }
}