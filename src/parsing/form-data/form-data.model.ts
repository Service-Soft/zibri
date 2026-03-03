import { File } from './file.model';
import { FsUtilities, Path } from '../../utilities';

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
    readonly tempFolder: Path;

    private constructor(value: FormDataType, tempFolder: Path) {
        this.value = value;
        this.tempFolder = tempFolder;
    }

    /**
     * Creates a new form data object from the given input.
     * @param value - The actual value of the form data.
     * @param tempFolder - The temporary folder that was created on uploading the form data.
     * @param cleanupAfterMs - A timeout after which the temporary folder is save to delete.
     * @returns A new FormData object.
     */
    static async create<FormDataType extends object>(
        value: FormDataType,
        tempFolder: Path,
        cleanupAfterMs: number
    ): Promise<FormData<FormDataType>> {
        const res: FormData<FormDataType> = new this(value, tempFolder);
        await FsUtilities.createFile(
            FsUtilities.getPath(res.tempFolder, CLEANUP_AT_FILE_NAME),
            `${Date.now() + cleanupAfterMs}`
        );
        return res;
    }

    /**
     * Deletes all temporary files belonging to this form data.
     */
    async cleanup(): Promise<void> {
        try {
            await FsUtilities.rm(this.tempFolder);
        }
        catch {
            // do nothing
        }
    }
}