import { InternalError } from '../error-handling/internal-error.model';
import { FileRecord } from './file-record.model';

/**
 * An error for a stored file whose bytes no longer hash to the SHA-256 they were stored with: changed or damaged in
 * the store since.
 */
export class FileHashMismatchError extends InternalError {
    /**
     * The id of the file.
     */
    readonly fileId: string;

    /**
     * Creates the error for the file whose bytes were refused.
     * @param file - The row of the file.
     */
    constructor(file: Pick<FileRecord, 'id' | 'name' | 'storeName'>) {
        super(
            `The file "${file.name}" (${file.id}) in the file store "${file.storeName}" does not match the SHA-256 it was `
            + 'stored with, so its bytes were refused.'
        );
        this.name = 'FileHashMismatchError';
        this.fileId = file.id;
    }
}