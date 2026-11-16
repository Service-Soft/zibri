import { createHash, Hash } from 'node:crypto';
import { FileHandle, FileReadResult, open } from 'node:fs/promises';
import { pipeline as pipeTo, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { constants, createZstdCompress, createZstdDecompress } from 'node:zlib';

import { BackupDigest } from './backup-digest.model';
import { BackupEncryptionUtilities } from './backup-encryption.utilities';
import { BackupChunkUtilities } from './repository/backup-chunk.utilities';
import { FetchedBackupChunk } from './repository/fetched-backup-chunk.model';
import { StagedChunksFile } from './staged-chunks-file.model';
import { StagedFile } from './staged-file.model';
import { StagingTransform } from './staging-transform.type';
import { ErrorUtilities } from '../error-handling/error.utilities';
import { InternalError } from '../error-handling/internal-error.model';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';

/**
 * How many bytes the id of a chunk takes in a staged file of chunks: a sha256, or an HMAC-SHA256 of it.
 */
const CHUNK_ID_BYTES: number = 32;

/**
 * What precedes each chunk in a staged file of chunks: its id, the length of its data and the length it was stored with.
 */
const CHUNK_RECORD_HEADER_BYTES: number = CHUNK_ID_BYTES + 4 + 4;

/**
 * What a backup or a restore keeps on this instance's disk on the way: writing it measured, compressed and
 * encrypted the way its file says, reading it back, and following a file as it is written.
 */
export abstract class StagingUtilities {
    /**
     * What a backup's data is summed with.
     *
     * A checksum here answers "is this the archive that was written", which collision resistance is not
     * what decides - but an archive is also exactly the thing somebody with write access to the storage
     * would want to swap, so the cheaper hashes that answer the first question do not answer the second.
     */
    private static readonly CHECKSUM_ALGORITHM: string = 'sha256';

    /**
     * How often a reader that has caught up with the writer looks for more.
     *
     * Only ever waited on when a reader is faster than whatever is producing the data, so it costs a stat
     * and nothing else.
     */
    private static readonly FOLLOW_POLL_INTERVAL_IN_MS: number = 50;

    /**
     * How hard a staged file is compressed.
     *
     * The fastest level: the file lives as long as one backup or restore, and the disk it saves is what is
     * worth having. What a transport stores is compressed again, each chunk on its own.
     */
    private static readonly COMPRESSION_LEVEL: number = 1;

    /**
     * How much a staged file is compressed or decompressed in one step, and what each piece handed on holds.
     *
     * Far above the default of 16 KiB, each step of which is a round trip to the thread pool and a piece
     * the readers after it handle on its own.
     */
    private static readonly COMPRESSION_CHUNK_BYTES: number = 256 * 1024;

    /**
     * Writes a stream to a file on the way past, measuring what goes through it.
     * @param data - The stream to write.
     * @param file - The file to write it to, and how it is stored, which {@link read} reads it back by.
     * @param transform - Applied after the data is measured and before it is stored, so the digest describes
     * the data as it arrived.
     * @returns What arrived, once the file holds all of it.
     */
    static async stage(data: Readable, file: StagedFile, transform?: StagingTransform): Promise<BackupDigest> {
        const digest: Hash = createHash(this.CHECKSUM_ALGORITHM);
        let size: number = 0;

        const measured: StagingTransform = async function* (source: AsyncIterable<unknown>): AsyncGenerator<Buffer> {
            for await (const chunk of source) {
                const buffer: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
                digest.update(buffer);
                size += buffer.length;
                yield buffer;
            }
        };
        const transformed: StagingTransform = transform == undefined ? measured : source => transform(measured(source));
        await pipeline(data, source => this.resolveStored(transformed(source), file), FsUtilities.createWriteStream(file.path));

        return { checksum: digest.digest('hex'), size };
    }

    /**
     * Writes the chunks a restore fetched to a file, as they were stored, which {@link read} reads back as their data.
     *
     * Each chunk after a header of its own: its id, the length of its data and the length it was stored with.
     * @param chunks - The chunks, in the order of the data.
     * @param file - The file.
     */
    static async writeChunks(chunks: AsyncIterable<FetchedBackupChunk>, file: StagedChunksFile): Promise<void> {
        const records: () => AsyncGenerator<Buffer> = async function* (): AsyncGenerator<Buffer> {
            for await (const { entry, stored } of chunks) {
                const header: Buffer = Buffer.alloc(CHUNK_RECORD_HEADER_BYTES);
                Buffer.from(entry.id, 'hex').copy(header, 0);
                header.writeUInt32BE(entry.length, CHUNK_ID_BYTES);
                header.writeUInt32BE(stored.length, CHUNK_ID_BYTES + 4);
                yield header;
                yield stored;
            }
        };
        await pipeline(records(), FsUtilities.createWriteStream(file.path));
    }

    /**
     * Compresses data on its way to a file it is staged in, which {@link decompress} reads back.
     * @param source - The data.
     * @returns The compressed data, which fails when the data does.
     */
    static compress(source: AsyncIterable<unknown>): Readable {
        return this.pipeThrough(source, createZstdCompress({
            chunkSize: this.COMPRESSION_CHUNK_BYTES,
            params: {
                [constants.ZSTD_c_compressionLevel]: this.COMPRESSION_LEVEL,
                // so that a file that changed on the disk since it was written fails to be read
                [constants.ZSTD_c_checksumFlag]: 1
            }
        }));
    }

    /**
     * Decompresses what {@link compress} compressed, read from its start.
     * @param source - The compressed data.
     * @returns The data, which fails when the compressed data does, is cut short or changed.
     */
    static decompress(source: AsyncIterable<unknown>): Readable {
        return this.pipeThrough(source, createZstdDecompress({ chunkSize: this.COMPRESSION_CHUNK_BYTES }));
    }

    /**
     * Reads a file that was staged.
     * @param file - The file, and how it was stored.
     * @returns What was handed over when it was staged, which fails when the file is not what was stored,
     * such as when it was compressed and is cut short or changed. Of a file of chunks, their data.
     */
    static read(file: StagedFile | StagedChunksFile): Readable {
        if (file.compression === 'chunks') {
            // each chunk checked against its id again: a file changed on the disk since is as much a reason to stop
            return Readable.from(this.validateSize(BackupChunkUtilities.openAll(this.readChunks(file.path), file.key), file));
        }
        const read: Readable = FsUtilities.createReadStream(file.path);
        const decrypted: Readable = file.encryption == undefined
            ? read
            : Readable.from(BackupEncryptionUtilities.decryptStaged(read, file.encryption.key, file.encryption.iv));
        return file.compression === 'zstd' ? this.decompress(decrypted) : decrypted;
    }

    /**
     * Measures a file that was staged, the way staging measured it.
     * @param file - The file, and how it was stored.
     * @returns What it holds.
     */
    static async resolveDigest(file: StagedFile): Promise<BackupDigest> {
        const digest: Hash = createHash(this.CHECKSUM_ALGORITHM);
        let size: number = 0;
        for await (const chunk of this.read(file)) {
            const buffer: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
            digest.update(buffer);
            size += buffer.length;
        }
        return { checksum: digest.digest('hex'), size };
    }

    /**
     * Reads a file that is still being written, from its start to wherever the writer stops.
     *
     * What lets a backup be stored and sent at the same time without either pacing the other. Piping one
     * stream to several destinations makes the slowest of them the speed of all of them, and of whatever
     * is producing the data - which for a database dump means holding its snapshot open for as long as
     * the slowest transport takes, a cost paid by the live database rather than by the backup. A file is
     * a buffer with no such limit, and one that does not have to fit in memory.
     * @param p - The file to follow.
     * @param written - The write in progress, which says when there will be no more and whether it failed.
     * @yields Each chunk as it lands, in order.
     * @throws Whatever the write threw, so a reader stops rather than treating a failure as an ending.
     */
    static async* followFile(p: FsPath, written: Promise<unknown>): AsyncGenerator<Buffer> {
        let offset: number = 0;
        let finished: boolean = false;
        let failure: Error | undefined;
        // watched here rather than awaited by the caller, so that a source which fails stops every reader
        // instead of leaving each one waiting for an end that is not coming
        void (async (): Promise<void> => {
            try {
                await written;
            }
            catch (error) {
                failure = error instanceof Error ? error : new Error(ErrorUtilities.unknownToErrorString(error));
            }
            finished = true;
        })();

        while (true) {
            // read before the stat, so that a write which finishes during it is seen as more data on the
            // next pass rather than as an ending that arrived before the last chunk
            const wasFinished: boolean = finished;
            const size: number = (await FsUtilities.stat(p)).size;

            if (size > offset) {
                for await (const chunk of FsUtilities.createReadStream(p, { start: offset, end: size - 1 })) {
                    yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
                }
                offset = size;
                continue;
            }
            if (failure != undefined) {
                throw failure;
            }
            if (wasFinished) {
                return;
            }
            await sleep(this.FOLLOW_POLL_INTERVAL_IN_MS);
        }
    }

    /**
     * Data as a staged file stores it: compressed, then encrypted.
     * @param source - The data.
     * @param file - How it is stored.
     * @returns The data as stored.
     */
    private static resolveStored(source: AsyncIterable<unknown>, file: StagedFile): AsyncIterable<Buffer> {
        // compressed before it is encrypted, after which nothing compresses
        const compressed: AsyncIterable<Buffer> = file.compression === 'zstd' ? this.compress(source) : this.toBuffers(source);
        return file.encryption == undefined
            ? compressed
            : BackupEncryptionUtilities.encryptStaged(compressed, file.encryption.key, file.encryption.iv);
    }

    /**
     * Hands on the data of a staged file of chunks, and fails once it ends at another size than the file holds.
     * @param data - The data.
     * @param file - The file.
     * @yields Each piece of the data.
     * @throws When the data ends at another size.
     */
    private static async* validateSize(data: AsyncIterable<Buffer>, file: StagedChunksFile): AsyncGenerator<Buffer> {
        let size: number = 0;
        for await (const piece of data) {
            size += piece.length;
            yield piece;
        }
        if (size !== file.size) {
            throw new InternalError(`The staged file "${file.path}" holds ${size} bytes of data, where it was staged with ${file.size}.`);
        }
    }

    /**
     * Reads the chunks {@link writeChunks} wrote, as they were stored.
     * @param p - The file.
     * @yields Each chunk, in order.
     * @throws When the file is cut short.
     */
    private static async* readChunks(p: FsPath): AsyncGenerator<FetchedBackupChunk> {
        const handle: FileHandle = await open(p, 'r');
        try {
            let position: number = 0;
            while (true) {
                const header: Buffer = Buffer.alloc(CHUNK_RECORD_HEADER_BYTES);
                const { bytesRead } = await handle.read(header, 0, header.length, position);
                if (bytesRead === 0) {
                    return;
                }
                if (bytesRead < header.length) {
                    throw new InternalError(`The staged file "${p}" ends inside the header of a chunk.`);
                }
                const storedLength: number = header.readUInt32BE(CHUNK_ID_BYTES + 4);
                const stored: Buffer = Buffer.alloc(storedLength);
                const body: FileReadResult<Buffer> = await handle.read(stored, 0, storedLength, position + header.length);
                if (body.bytesRead < storedLength) {
                    throw new InternalError(`The staged file "${p}" ends inside a chunk.`);
                }
                position += header.length + storedLength;
                yield {
                    entry: { id: header.subarray(0, CHUNK_ID_BYTES).toString('hex'), length: header.readUInt32BE(CHUNK_ID_BYTES) },
                    stored
                };
            }
        }
        finally {
            await handle.close();
        }
    }

    /**
     * Hands data on as buffers.
     * @param source - The data.
     * @yields Each piece as a buffer.
     */
    private static async* toBuffers(source: AsyncIterable<unknown>): AsyncGenerator<Buffer> {
        for await (const piece of source) {
            yield Buffer.isBuffer(piece) ? piece : Buffer.from(String(piece));
        }
    }

    /**
     * Hands data through a transform, as a stream its reader reads.
     * @param source - The data.
     * @param transform - The transform.
     * @returns The transform, destroyed with the error when the data or the transform fails.
     */
    private static pipeThrough(source: AsyncIterable<unknown>, transform: Transform): Readable {
        // the callback says nothing the transform does not: a failure anywhere destroys it with the error,
        // which is how its reader learns of it, and a reader that stops early ends the source as well
        return pipeTo(source, transform, () => undefined);
    }
}