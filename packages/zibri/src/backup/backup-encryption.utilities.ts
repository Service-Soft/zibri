import { CipherGCM, CipherGCMTypes, createCipheriv, createDecipheriv, DecipherGCM, randomBytes } from 'node:crypto';

import { InternalError } from '../error-handling/internal-error.model';

/**
 * What a backup's data is encrypted with.
 */
const BACKUP_CIPHER: CipherGCMTypes = 'aes-256-gcm';

/**
 * How many bytes of a backup's data are sealed together.
 *
 * Chunks rather than one gcm message, because a single message under one nonce tops out at about
 * 64gb, and a backup may be larger. Each chunk is authenticated on its own, so a restore finds a
 * damaged one without having read everything after it.
 */
const CHUNK_SIZE_IN_BYTES: number = 64 * 1024;

/**
 * How many bytes of authentication tag follow each chunk.
 */
const TAG_LENGTH_IN_BYTES: number = 16;

/**
 * How many bytes a sealed chunk takes, except for the last one, which may be shorter.
 */
const SEALED_CHUNK_SIZE_IN_BYTES: number = CHUNK_SIZE_IN_BYTES + TAG_LENGTH_IN_BYTES;

/**
 * How many bytes a backup's data key is.
 */
const KEY_LENGTH_IN_BYTES: number = 32;

/**
 * How a resource's backup data is encrypted, as the stored archive holds it.
 */
export abstract class BackupEncryptionUtilities {
    /**
     * Generates a key for one resource's backup data.
     * @returns A random key.
     */
    static generateKey(): Buffer {
        return randomBytes(KEY_LENGTH_IN_BYTES);
    }

    /**
     * Encrypts a resource's backup data as it goes past.
     * @param source - The data to encrypt.
     * @param key - The key to encrypt it with.
     * @yields Each sealed chunk, in order.
     */
    static async* encrypt(source: AsyncIterable<unknown>, key: Buffer): AsyncGenerator<Buffer> {
        let pending: Buffer = Buffer.alloc(0);
        let index: number = 0;
        for await (const chunk of source) {
            pending = Buffer.concat([pending, this.toBuffer(chunk)]);
            // strictly more than one chunk's worth: the last chunk is sealed as the last one, and only
            // the end of the source says which chunk that is
            while (pending.length > CHUNK_SIZE_IN_BYTES) {
                yield this.seal(pending.subarray(0, CHUNK_SIZE_IN_BYTES), key, index, false);
                pending = pending.subarray(CHUNK_SIZE_IN_BYTES);
                index++;
            }
        }
        // always, even when it is empty: an archive that ends without a chunk sealed as the last one
        // is how a decryption tells an archive cut short at a chunk boundary from a whole one
        yield this.seal(pending, key, index, true);
    }

    /**
     * Decrypts a resource's backup data as it goes past.
     * @param source - The data as it is stored.
     * @param key - The key it was encrypted with.
     * @yields Each chunk's data, in order, only once that chunk is authenticated.
     * @throws When a chunk was changed, moved, cut short or left out, or the key is not the one it was
     * encrypted with.
     */
    static async* decrypt(source: AsyncIterable<unknown>, key: Buffer): AsyncGenerator<Buffer> {
        let pending: Buffer = Buffer.alloc(0);
        let index: number = 0;
        for await (const chunk of source) {
            pending = Buffer.concat([pending, this.toBuffer(chunk)]);
            while (pending.length > SEALED_CHUNK_SIZE_IN_BYTES) {
                yield this.open(pending.subarray(0, SEALED_CHUNK_SIZE_IN_BYTES), key, index, false);
                pending = pending.subarray(SEALED_CHUNK_SIZE_IN_BYTES);
                index++;
            }
        }
        yield this.open(pending, key, index, true);
    }

    private static seal(data: Buffer, key: Buffer, index: number, isLast: boolean): Buffer {
        const cipher: CipherGCM = createCipheriv(
            BACKUP_CIPHER,
            key,
            this.resolveNonce(index, isLast),
            { authTagLength: TAG_LENGTH_IN_BYTES }
        );
        return Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
    }

    private static open(sealed: Buffer, key: Buffer, index: number, isLast: boolean): Buffer {
        if (sealed.length < TAG_LENGTH_IN_BYTES) {
            throw this.createDecryptionError(index);
        }
        const decipher: DecipherGCM = createDecipheriv(
            BACKUP_CIPHER,
            key,
            this.resolveNonce(index, isLast),
            { authTagLength: TAG_LENGTH_IN_BYTES }
        );
        decipher.setAuthTag(sealed.subarray(sealed.length - TAG_LENGTH_IN_BYTES));
        try {
            return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_LENGTH_IN_BYTES)), decipher.final()]);
        }
        catch (error) {
            throw this.createDecryptionError(index, error);
        }
    }

    /**
     * The nonce a chunk is sealed with.
     *
     * The chunk's position and whether it is the last one, which is the STREAM construction: a chunk
     * moved to another position, or an archive ending on a chunk that was not sealed as the last one,
     * no longer authenticates. Nothing random is needed, because every resource's data gets a key of
     * its own, so no nonce is ever used twice under one key.
     * @param index - The chunk's position, from zero.
     * @param isLast - Whether it is the last chunk.
     * @returns The nonce.
     */
    private static resolveNonce(index: number, isLast: boolean): Buffer {
        const nonce: Buffer = Buffer.alloc(12);
        // six bytes of position, which writeUIntBE reaches at most, and which is more chunks than any
        // archive has
        nonce.writeUIntBE(index, 5, 6);
        nonce.writeUInt8(isLast ? 1 : 0, 11);
        return nonce;
    }

    private static createDecryptionError(index: number, cause?: unknown): InternalError {
        return new InternalError(
            [
                `The backup data could not be decrypted at chunk ${index}.`,
                'It was changed or cut short where it is stored, or it was not encrypted with this key.'
            ],
            { cause }
        );
    }

    private static toBuffer(chunk: unknown): Buffer {
        return Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    }
}