import { randomUUID } from 'node:crypto';

/**
 * Any string a store that types its columns as uuid is able to hold.
 *
 * Deliberately looser than the rfc: the version and variant digits are not pinned. This answers
 * whether a stored value could look like this, and a value that was written is a value that can be
 * read back regardless of which version produced it.
 */
const uuidShape: RegExp = /^[\dA-Fa-f]{8}(?:-[\dA-Fa-f]{4}){3}-[\dA-Fa-f]{12}$/;

/**
 * Utilities for dealing with uuid.
 */
export abstract class UUIDUtilities {
    /**
     * Generate a new uuid.
     * @returns A v4 uuid string.
     */
    static generate(): string {
        return randomUUID();
    }

    /**
     * Whether the given value has the shape of a uuid.
     *
     * Answers what a store could be holding, not what an api accepts - the validation applied to an
     * incoming `format: 'uuid'` value is stricter, because refusing an unusual uuid at the edge only
     * costs a request, while failing to recognize one here would report a row that exists as absent.
     * @param value - The value to check.
     * @returns True if a uuid could be written exactly like this, false otherwise.
     */
    static isUuid(value: string): boolean {
        return uuidShape.test(value);
    }
}