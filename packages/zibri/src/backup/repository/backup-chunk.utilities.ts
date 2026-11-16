import { createHash, createHmac, Hash, randomBytes, webcrypto } from 'node:crypto';
import { promisify } from 'node:util';
import { constants, zstdCompress, zstdDecompress } from 'node:zlib';

import { BackupRepositoryKey } from './backup-repository-key.model';
import { FetchedBackupChunk } from './fetched-backup-chunk.model';
import { InternalError } from '../../error-handling/internal-error.model';

/**
 * How zstd compresses a chunk.
 */
type ZstdCompressOptions = {
    /**
     * The size of the pieces the compressed data is handed back in.
     */
    chunkSize: number,
    /**
     * The parameters of zstd, by their constant.
     */
    params: Record<number, number>
};

/**
 * How zstd decompresses a chunk.
 */
type ZstdDecompressOptions = {
    /**
     * How many bytes the decompressed data may hold at most.
     */
    maxOutputLength: number
};

// zstd is experimental in node, and what the chunks of format 2 are compressed with
// eslint-disable-next-line angular/no-experimental
const zstdCompressAsync: (data: Buffer, options: ZstdCompressOptions) => Promise<Buffer> = promisify(zstdCompress);
// eslint-disable-next-line angular/no-experimental
const zstdDecompressAsync: (data: Buffer, options: ZstdDecompressOptions) => Promise<Buffer> = promisify(zstdDecompress);

/**
 * What the first byte of a stored chunk says: the shape of the bytes after it. A new shape is a new
 * value, so a build reading an older one still knows what it holds.
 */
const CHUNK_OBJECT_FORMAT: number = 1;

/**
 * How a chunk's data is stored, as the second byte says.
 */
enum ChunkCompression {
    NONE = 0,
    ZSTD = 1
}

/**
 * The id key and the data key of each repository key, imported for web crypto.
 */
const HMAC_KEYS: WeakMap<Buffer, Promise<webcrypto.CryptoKey>> = new WeakMap();
const AES_KEYS: WeakMap<Buffer, Promise<webcrypto.CryptoKey>> = new WeakMap();

/**
 * How many chunks {@link BackupChunkUtilities.openAll} opens ahead of the one it hands on, each held with its data.
 */
const CHUNKS_OPENED_AHEAD: number = 4;

const HEADER_BYTES: number = 2;
const NONCE_BYTES: number = 12;
const TAG_BYTES: number = 16;

/**
 * How a chunk of a deduplicated backup is named, sealed and opened again.
 */
export abstract class BackupChunkUtilities {
    /**
     * How many bytes a stored chunk takes beyond its data at most: the header, and the nonce and tag of an
     * encrypted one. Never more, since a chunk compression does not shrink is stored as it is.
     */
    static readonly OVERHEAD_BYTES: number = HEADER_BYTES + NONCE_BYTES + TAG_BYTES;

    /**
     * Starts the digest a chunk's id is, which a resource's checksum is too.
     *
     * Keyed for an encrypted chunk, so that someone who can list the store cannot tell whether a file they
     * know is in it. A plain sha256 for an unencrypted one, whose data is readable anyway.
     * @param key - The repository key, or undefined for an unencrypted chunk.
     * @returns The digest, to be updated with the data.
     */
    // the type createHmac returns: naming the Hmac class is deprecated in node
    static createDigest(key: BackupRepositoryKey | undefined): Hash | ReturnType<typeof createHmac> {
        return key == undefined ? createHash('sha256') : createHmac('sha256', key.idKey);
    }

    /**
     * The id of a chunk, the digest {@link createDigest} starts.
     * @param data - The chunk's data.
     * @param key - The repository key, or undefined for an unencrypted chunk.
     * @returns The id, hex encoded.
     */
    static async resolveId(data: Buffer, key: BackupRepositoryKey | undefined): Promise<string> {
        // through web crypto, which hashes on a thread of the pool rather than the one the application runs
        // on: a backup hashes every byte it stores, beside the chunker and whatever produces the data
        const digest: ArrayBuffer = key == undefined
            ? await webcrypto.subtle.digest('SHA-256', data)
            : await webcrypto.subtle.sign('HMAC', await this.resolveImportedKey(HMAC_KEYS, key.idKey, 'HMAC'), data);
        return Buffer.from(digest).toString('hex');
    }

    /**
     * Compresses and encrypts a chunk the way it is stored.
     * @param data - The chunk's data.
     * @param id - Its id, which the encryption is bound to.
     * @param key - The repository key, or undefined to store it unencrypted.
     * @param compressionLevel - How hard zstd compresses it.
     * @returns The bytes to store.
     */
    static async seal(data: Buffer, id: string, key: BackupRepositoryKey | undefined, compressionLevel: number): Promise<Buffer> {
        // handed back in one piece rather than in pieces of 16 KiB joined afterwards
        const compressed: Buffer = await zstdCompressAsync(data, {
            chunkSize: Math.max(constants.Z_MIN_CHUNK, data.length),
            params: { [constants.ZSTD_c_compressionLevel]: compressionLevel }
        });
        // what compression does not shrink, such as data a resource compressed itself, is stored as it is
        const [compression, payload]: [ChunkCompression, Buffer] = compressed.length < data.length
            ? [ChunkCompression.ZSTD, compressed]
            : [ChunkCompression.NONE, data];
        const header: Buffer = Buffer.from([CHUNK_OBJECT_FORMAT, compression]);
        if (key == undefined) {
            return Buffer.concat([header, payload]);
        }
        // random, since equal ids are what deduplicate and nothing needs equal ciphertext
        const nonce: Buffer = randomBytes(NONCE_BYTES);
        // on a thread of the pool, as the id is. Web crypto hands back the ciphertext with the tag after it,
        // which is how a chunk stores them
        const sealed: ArrayBuffer = await webcrypto.subtle.encrypt(
            { name: 'AES-GCM', iv: nonce, additionalData: this.resolveAdditionalData(header, id), tagLength: TAG_BYTES * 8 },
            await this.resolveImportedKey(AES_KEYS, key.dataKey, 'AES-GCM'),
            payload
        );
        return Buffer.concat([header, nonce, Buffer.from(sealed)]);
    }

    /**
     * Whether a stored chunk is in a shape a newer build writes: a format or a compression past the ones
     * this build knows. {@link open} Refuses it all the same, without saying that it was changed.
     * @param stored - The bytes as they are stored.
     * @returns Whether it is.
     */
    static isOfNewerBuild(stored: Buffer): boolean {
        const [format, compression] = stored;
        // ZSTD is the last compression this build knows
        return format != undefined && compression != undefined
            && (format > CHUNK_OBJECT_FORMAT || (format === CHUNK_OBJECT_FORMAT && compression > ChunkCompression.ZSTD));
    }

    /**
     * Decrypts and decompresses a stored chunk, once it is found to be the chunk of the id.
     * @param stored - The bytes as they are stored.
     * @param id - The id it is stored under.
     * @param key - The repository key, or undefined for an unencrypted chunk.
     * @param length - How many bytes the chunk's data is, as the manifest says.
     * @returns The chunk's data.
     * @throws When the bytes are not the chunk of the id: changed, cut short, or stored under another id.
     */
    static async open(stored: Buffer, id: string, key: BackupRepositoryKey | undefined, length: number): Promise<Buffer> {
        const header: Buffer = stored.subarray(0, HEADER_BYTES);
        if (header.length < HEADER_BYTES || header[0] !== CHUNK_OBJECT_FORMAT) {
            throw this.createUnreadableError(id, `it starts with ${header.toString('hex')}, which this build does not read`);
        }
        const payload: Buffer = key == undefined ? stored.subarray(HEADER_BYTES) : await this.decrypt(stored, header, id, key);
        let data: Buffer;
        switch (header[1]) {
            case ChunkCompression.NONE: {
                data = payload;
                break;
            }
            case ChunkCompression.ZSTD: {
                try {
                    data = await zstdDecompressAsync(payload, { maxOutputLength: length });
                }
                catch (error) {
                    throw this.createUnreadableError(id, 'it does not decompress to its length', error);
                }
                break;
            }
            case undefined:
            default: {
                throw this.createUnreadableError(id, `it is compressed in a way this build does not read (${header[1]})`);
            }
        }
        // the id checked as well: what an unencrypted chunk is held to at all, and for an encrypted one
        // what proves the data was not encrypted with this key under another id
        if (data.length !== length || await this.resolveId(data, key) !== id) {
            throw this.createUnreadableError(id, 'its data is not the data of its id');
        }
        return data;
    }

    /**
     * The data of chunks kept as they were stored, opened a few ahead, so that decompressing and hashing one, on
     * the thread pool, overlaps with whatever reads the one before it.
     * @param chunks - The chunks, in the order of the data.
     * @param key - The repository key, or undefined for unencrypted chunks.
     * @yields The data of each chunk, in order.
     * @throws When a chunk is not the chunk of its id.
     */
    static async* openAll(chunks: AsyncIterable<FetchedBackupChunk>, key: BackupRepositoryKey | undefined): AsyncGenerator<Buffer> {
        const iterator: AsyncIterator<FetchedBackupChunk> = chunks[Symbol.asyncIterator]();
        const ahead: Promise<Buffer>[] = [];
        let read: boolean = false;
        try {
            while (true) {
                while (!read && ahead.length < CHUNKS_OPENED_AHEAD) {
                    const next: IteratorResult<FetchedBackupChunk> = await iterator.next();
                    if (next.done === true) {
                        read = true;
                        break;
                    }
                    const { entry, stored } = next.value;
                    const opened: Promise<Buffer> = this.open(stored, entry.id, key, entry.length);
                    // handled when its turn comes; until then a failure must not count as unhandled
                    // eslint-disable-next-line promise/prefer-await-to-then
                    opened.catch(() => undefined);
                    ahead.push(opened);
                }
                const chunk: Promise<Buffer> | undefined = ahead.shift();
                if (chunk == undefined) {
                    return;
                }
                yield await chunk;
            }
        }
        finally {
            await Promise.allSettled(ahead);
            await iterator.return?.();
        }
    }

    private static async decrypt(stored: Buffer, header: Buffer, id: string, key: BackupRepositoryKey): Promise<Buffer> {
        if (stored.length < this.OVERHEAD_BYTES) {
            throw this.createUnreadableError(id, 'it is cut short');
        }
        const cryptoKey: webcrypto.CryptoKey = await this.resolveImportedKey(AES_KEYS, key.dataKey, 'AES-GCM');
        try {
            return Buffer.from(await webcrypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: stored.subarray(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES),
                    additionalData: this.resolveAdditionalData(header, id),
                    tagLength: TAG_BYTES * 8
                },
                cryptoKey,
                stored.subarray(HEADER_BYTES + NONCE_BYTES)
            ));
        }
        catch (error) {
            throw this.createUnreadableError(id, 'it does not decrypt: it was changed, or encrypted with another key', error);
        }
    }

    /**
     * A key as web crypto takes it, imported once for every chunk sealed, opened or hashed with it.
     * @param cache - The keys imported so far, by their bytes.
     * @param bytes - The bytes of the key.
     * @param algorithm - What it is used for.
     * @returns The key.
     */
    private static async resolveImportedKey(
        cache: WeakMap<Buffer, Promise<webcrypto.CryptoKey>>,
        bytes: Buffer,
        algorithm: 'AES-GCM' | 'HMAC'
    ): Promise<webcrypto.CryptoKey> {
        const known: Promise<webcrypto.CryptoKey> | undefined = cache.get(bytes);
        if (known != undefined) {
            return await known;
        }
        const imported: Promise<webcrypto.CryptoKey> = algorithm === 'HMAC'
            ? webcrypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
            : webcrypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        cache.set(bytes, imported);
        return await imported;
    }

    /**
     * What a chunk's encryption is bound to beside its data: the header, so that no one can flip how it is
     * read, and the id, so that the chunk does not decrypt under any other.
     * @param header - The header.
     * @param id - The id.
     * @returns The bytes.
     */
    private static resolveAdditionalData(header: Buffer, id: string): Buffer {
        return Buffer.concat([header, Buffer.from(id, 'hex')]);
    }

    private static createUnreadableError(id: string, reason: string, cause?: unknown): InternalError {
        return new InternalError(`The chunk ${id} is not the chunk it is stored as: ${reason}.`, { cause });
    }
}