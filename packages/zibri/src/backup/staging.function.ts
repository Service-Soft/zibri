import { createHash, Hash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import { ErrorUtilities } from '../error-handling/error.utilities';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';

/**
 * What a backup's data is summed with.
 *
 * A checksum here answers "is this the archive that was written", which collision resistance is not
 * what decides - but an archive is also exactly the thing somebody with write access to the storage
 * would want to swap, so the cheaper hashes that answer the first question do not answer the second.
 */
const BACKUP_CHECKSUM_ALGORITHM: string = 'sha256';

/**
 * How often a reader that has caught up with the writer looks for more.
 *
 * Only ever waited on when a reader is faster than whatever is producing the data, so it costs a stat
 * and nothing else.
 */
const FOLLOW_POLL_INTERVAL_IN_MS: number = 50;

/**
 * What a resource's data was, as every transport received it.
 */
export type BackupDigest = {
    /**
     * The sha256 of the data, hex encoded.
     */
    checksum: string,
    /**
     * How many bytes it was.
     */
    size: number
};

/**
 * Changes data on its way to the file it is staged in.
 */
export type StagingTransform = (source: AsyncIterable<Buffer>) => AsyncIterable<Buffer>;

/**
 * Writes a stream to a file on the way past, measuring what goes through it.
 * @param data - The stream to write.
 * @param p - The file to write it to.
 * @param transform - Applied after the data is measured and before it is written, so the digest
 * describes the data as it arrived.
 * @returns What arrived, once the file holds all of it.
 */
export async function stage(data: Readable, p: FsPath, transform?: StagingTransform): Promise<BackupDigest> {
    const digest: Hash = createHash(BACKUP_CHECKSUM_ALGORITHM);
    let size: number = 0;

    const measured: StagingTransform = async function* (source: AsyncIterable<unknown>): AsyncGenerator<Buffer> {
        for await (const chunk of source) {
            const buffer: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
            digest.update(buffer);
            size += buffer.length;
            yield buffer;
        }
    };
    await (transform
        ? pipeline(data, measured, transform, FsUtilities.createWriteStream(p))
        : pipeline(data, measured, FsUtilities.createWriteStream(p)));

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
export async function* followFile(p: FsPath, written: Promise<unknown>): AsyncGenerator<Buffer> {
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
        await sleep(FOLLOW_POLL_INTERVAL_IN_MS);
    }
}