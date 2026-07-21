import { randomUUID } from 'node:crypto';

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
}