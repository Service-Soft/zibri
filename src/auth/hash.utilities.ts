import { hash, compare, genSalt } from 'bcryptjs';

/**
 * Provides utilities around hashing and comparing hashes.
 */
export abstract class HashUtilities {
    /**
     * Hashes the given value.
     * @param value - The value to hash.
     * @returns A bcrypt hash.
     */
    static async hash(value: string): Promise<string> {
        return await hash(value, await genSalt());
    }
    /**
     * Checks if the hash of the given value equals the hash.
     * @param value - The value to compare.
     * @param hash - The hash to compare against.
     * @returns True when they are equal, false otherwise.
     */
    static async equal(value: string, hash: string): Promise<boolean> {
        return await compare(value, hash);
    }
}