import { hkdfSync, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

import { InternalError } from '../../error-handling/internal-error.model';
import { BackupEncryptionUtilities } from '../backup-encryption.utilities';
import { BackupChunkUtilities } from './backup-chunk.utilities';
import { BackupManifestEntry } from './backup-manifest-entry.model';
import { BackupRepositoryKey } from './backup-repository-key.model';
import { BackupStoredResource } from './backup-stored-resource.model';

/**
 * What the first byte of the object a resource is stored under says: the shape of the bytes after it.
 */
const STORED_RESOURCE_FORMAT: number = 1;

/**
 * What the second byte says the object holds.
 */
enum StoredResourceKind {
    ENCRYPTED_CHUNKS = 1,
    CHUNKS = 2,
    WHOLE = 3
}

const ID_BYTES: number = 32;
const LENGTH_BYTES: number = 4;
const ENTRY_BYTES: number = ID_BYTES + LENGTH_BYTES;
const SALT_BYTES: number = 16;

/**
 * How the object a resource of a deduplicated backup is stored under is written and read: a manifest of
 * its chunks, or its data as one piece.
 */
export abstract class BackupManifestUtilities {
    // the most a manifest may weigh is derived from it before the manifest is read, which is why the
    // chunking options cannot go below it
    /**
     * The smallest `minChunkBytes` the chunking options may set.
     */
    static readonly SMALLEST_CHUNK_BYTES: number = 16 * 1024;

    /**
     * The first bytes of an object holding a resource's data as one piece, which the data follows.
     * @returns The bytes.
     */
    static resolveWholeHeader(): Buffer {
        return Buffer.from([STORED_RESOURCE_FORMAT, StoredResourceKind.WHOLE]);
    }

    /**
     * Writes the manifest of a resource.
     * @param entries - Its chunks, in order.
     * @param key - The repository key to encrypt it with, or undefined to store it unencrypted.
     * @returns The bytes to store.
     */
    static async encodeChunks(entries: BackupManifestEntry[], key: BackupRepositoryKey | undefined): Promise<Buffer> {
        const body: Buffer = Buffer.alloc(entries.length * ENTRY_BYTES);
        for (const [i, entry] of entries.entries()) {
            body.write(entry.id, i * ENTRY_BYTES, ID_BYTES, 'hex');
            body.writeUInt32BE(entry.length, (i * ENTRY_BYTES) + ID_BYTES);
        }
        if (key == undefined) {
            return Buffer.concat([Buffer.from([STORED_RESOURCE_FORMAT, StoredResourceKind.CHUNKS]), body]);
        }
        const keyId: Buffer = Buffer.from(key.id);
        // a salt of its own per manifest, so the key it is sealed with is never used twice, even by a
        // second attempt at the same resource that ends up with other chunks
        const salt: Buffer = randomBytes(SALT_BYTES);
        const sealed: Buffer[] = [];
        for await (const frame of BackupEncryptionUtilities.encrypt(Readable.from([body]), this.resolveManifestKey(key, salt))) {
            sealed.push(frame);
        }
        return Buffer.concat([
            Buffer.from([STORED_RESOURCE_FORMAT, StoredResourceKind.ENCRYPTED_CHUNKS, keyId.length]),
            keyId,
            salt,
            ...sealed
        ]);
    }

    /**
     * Reads what the object a resource is stored under holds, as far as its first bytes say.
     * @param source - The object, as the store hands it over.
     * @returns The data as one piece, still being read, or the rest of the manifest.
     * @throws When the object is in a shape this build does not read.
     */
    static async read(source: AsyncIterable<unknown>): Promise<BackupStoredResource> {
        const iterator: AsyncIterator<unknown> = source[Symbol.asyncIterator]();
        let read: Buffer = Buffer.alloc(0);
        const readAtLeast: (length: number) => Promise<boolean> = async length => {
            while (read.length < length) {
                const next: IteratorResult<unknown> = await iterator.next();
                if (next.done == true) {
                    return false;
                }
                read = Buffer.concat([read, Buffer.isBuffer(next.value) ? next.value : Buffer.from(String(next.value))]);
            }
            return true;
        };
        if (!await readAtLeast(2) || read[0] !== STORED_RESOURCE_FORMAT) {
            await iterator.return?.();
            throw new InternalError(
                `A stored resource starts with ${read.subarray(0, 2).toString('hex')}, which this build does not read.`
            );
        }
        switch (read[1]) {
            case StoredResourceKind.WHOLE: {
                return { kind: 'whole', data: this.continueWith(read.subarray(2), iterator) };
            }
            case StoredResourceKind.CHUNKS: {
                return { kind: 'chunks', keyId: undefined, body: await this.readToEnd(read.subarray(2), iterator) };
            }
            case StoredResourceKind.ENCRYPTED_CHUNKS: {
                const keyIdLength: number = await readAtLeast(3) ? read[2] ?? 0 : 0;
                if (!keyIdLength || !await readAtLeast(3 + keyIdLength)) {
                    await iterator.return?.();
                    throw new InternalError('A stored manifest is cut short before the key it is encrypted with.');
                }
                return {
                    kind: 'chunks',
                    keyId: read.subarray(3, 3 + keyIdLength).toString(),
                    body: await this.readToEnd(read.subarray(3 + keyIdLength), iterator)
                };
            }
            case undefined:
            default: {
                await iterator.return?.();
                throw new InternalError(`A stored resource holds a kind this build does not read (${read[1]}).`);
            }
        }
    }

    /**
     * Reads the chunks out of the rest of a manifest.
     * @param body - The rest of the manifest, as {@link read} hands it over.
     * @param key - The repository key it was encrypted with, or undefined for an unencrypted one.
     * @returns The chunks, in order.
     * @throws When the manifest was changed or cut short where it is stored.
     */
    static async decodeEntries(body: Buffer, key: BackupRepositoryKey | undefined): Promise<BackupManifestEntry[]> {
        let entries: Buffer = body;
        if (key != undefined) {
            const opened: Buffer[] = [];
            const sealed: Readable = Readable.from([body.subarray(SALT_BYTES)]);
            const manifestKey: Buffer = this.resolveManifestKey(key, body.subarray(0, SALT_BYTES));
            for await (const frame of BackupEncryptionUtilities.decrypt(sealed, manifestKey)) {
                opened.push(frame);
            }
            entries = Buffer.concat(opened);
        }
        if (entries.length % ENTRY_BYTES !== 0) {
            throw new InternalError(`A stored manifest holds ${entries.length} bytes of chunks, which is no whole number of them.`);
        }
        return Array.from({ length: entries.length / ENTRY_BYTES }, (_, i) => ({
            id: entries.subarray(i * ENTRY_BYTES, (i * ENTRY_BYTES) + ID_BYTES).toString('hex'),
            length: entries.readUInt32BE((i * ENTRY_BYTES) + ID_BYTES)
        }));
    }

    /**
     * The checksum of the data of a resource stored as chunks: the hash of its chunks in order, each by
     * its id and its length, keyed as the ids are.
     *
     * The ids already hash the data of each chunk, so the list of them stands for the data, and summing
     * the data a second time would only cost a pass over it.
     * @param entries - The chunks, in order.
     * @param key - The repository key, or undefined for unencrypted chunks.
     * @returns The checksum, hex encoded.
     */
    static resolveChecksum(entries: BackupManifestEntry[], key: BackupRepositoryKey | undefined): string {
        const digest: ReturnType<typeof BackupChunkUtilities.createDigest> = BackupChunkUtilities.createDigest(key);
        const length: Buffer = Buffer.alloc(LENGTH_BYTES);
        for (const entry of entries) {
            length.writeUInt32BE(entry.length);
            digest.update(Buffer.from(entry.id, 'hex')).update(length);
        }
        return digest.digest('hex');
    }

    /**
     * The most the object a resource is stored under may weigh, which a restore reads no more than.
     * @param size - The size of the resource as the backup recorded it: of its data for a chunked one,
     * as stored for one in one piece.
     * @returns The most bytes.
     */
    static resolveMaxBytes(size: number): number {
        // a manifest lists at most a chunk per smallest chunk and one more, and its encryption adds a tag
        // per 64 KiB of it; the data in one piece is the size it was recorded as, after the header
        const manifest: number = 512 + (2 * ENTRY_BYTES * (Math.ceil(size / this.SMALLEST_CHUNK_BYTES) + 1));
        return Math.max(manifest, 2 + size);
    }

    /**
     * The key a manifest is sealed with: derived, so that nothing has to be stored beside it.
     * @param key - The repository key.
     * @param salt - The salt the manifest was written with.
     * @returns The key.
     */
    private static resolveManifestKey(key: BackupRepositoryKey, salt: Buffer): Buffer {
        return Buffer.from(hkdfSync('sha256', key.dataKey, salt, 'zibri backup manifest', 32));
    }

    private static async* continueWith(start: Buffer, iterator: AsyncIterator<unknown>): AsyncGenerator<Buffer> {
        try {
            if (start.length) {
                yield start;
            }
            for (;;) {
                const next: IteratorResult<unknown> = await iterator.next();
                if (next.done == true) {
                    return;
                }
                yield Buffer.isBuffer(next.value) ? next.value : Buffer.from(String(next.value));
            }
        }
        finally {
            // a reader stopping early ends the store's stream as well
            await iterator.return?.();
        }
    }

    private static async readToEnd(start: Buffer, iterator: AsyncIterator<unknown>): Promise<Buffer> {
        const pieces: Buffer[] = [];
        for await (const piece of this.continueWith(start, iterator)) {
            pieces.push(piece);
        }
        return Buffer.concat(pieces);
    }
}