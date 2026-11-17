import { BackupDigest } from './backup-digest.model';
import { RestoreJournalEntry } from './restore-journal-entry.model';
import { RestoreJournal } from './restore-journal.model';
import { StagedFileEncryption } from './staged-file-encryption.model';
import { StagedFile } from './staged-file.model';
import { type EncryptionServiceInterface } from '../auth/encryption/encryption-service.interface';
import { type EncryptionString } from '../auth/encryption/encryption.utilities';
import { InternalError } from '../error-handling/internal-error.model';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';

/**
 * Reads and writes the journals a restore keeps beside its snapshots.
 *
 * A journal outlives the restore only when the process running it was killed, so finding one means
 * the resources it names were left half restored.
 */
export abstract class RestoreJournalUtilities {
    private static readonly suffix: string = '.restore-journal.json';

    private static readonly keyBytes: number = 32;

    // the key, then the IV
    private static readonly encryptionBytes: number = 48;

    /**
     * Where the journal of a restore of the given backup is kept.
     * @param stagingFolder - The folder restores stage in.
     * @param backupId - The id of the backup being restored.
     * @returns The path of the journal.
     */
    static getPath(stagingFolder: FsPath, backupId: string): FsPath {
        return FsUtilities.getPath(stagingFolder, `${backupId}${this.suffix}`);
    }

    /**
     * Finds the journals in the given folder.
     * @param stagingFolder - The folder restores stage in.
     * @returns Their paths, or none.
     */
    static async findPaths(stagingFolder: FsPath): Promise<FsPath[]> {
        return await FsUtilities.glob(FsUtilities.getPath(stagingFolder, `*${this.suffix}`));
    }

    /**
     * Reads a journal.
     * @param p - The path of the journal.
     * @returns The journal.
     * @throws When the file cannot be read or is no journal.
     */
    static async resolve(p: FsPath): Promise<RestoreJournal> {
        return JsonUtilities.parse<RestoreJournal>(await FsUtilities.readFile(p));
    }

    /**
     * The entry of a resource a restore is about to apply.
     * @param resourceName - The name of the resource.
     * @param snapshot - The snapshot of what it holds now.
     * @param snapshotDigest - What the snapshot held when it was written.
     * @param encryptionService - What the key of an encrypted snapshot is encrypted by, with the master key.
     * @returns The entry.
     */
    static async resolveEntry(
        resourceName: string,
        snapshot: StagedFile,
        snapshotDigest: BackupDigest,
        encryptionService: EncryptionServiceInterface
    ): Promise<RestoreJournalEntry> {
        // the journal is the one place the key of the snapshot outlives the process, which the next start
        // needs to put it back. Encrypted by the master key, so that the disk holding both holds neither readably
        const snapshotEncryptionKey: EncryptionString | undefined = snapshot.encryption == undefined
            ? undefined
            : await encryptionService.masterEncrypt(Buffer.concat([snapshot.encryption.key, snapshot.encryption.iv]).toString('base64'));
        return {
            resourceName,
            snapshotPath: snapshot.path,
            snapshotDigest,
            snapshotCompression: snapshot.compression,
            ...snapshotEncryptionKey == undefined ? {} : { snapshotEncryptionKey }
        };
    }

    /**
     * The snapshot an entry names, and how it is stored.
     * @param entry - The entry.
     * @param encryptionService - What the key of an encrypted snapshot is decrypted by, with the master key.
     * @returns The snapshot.
     * @throws When the key of an encrypted snapshot cannot be decrypted, such as under a master key the
     * application no longer holds.
     */
    static async resolveSnapshot(entry: RestoreJournalEntry, encryptionService: EncryptionServiceInterface): Promise<StagedFile> {
        let encryption: StagedFileEncryption | undefined;
        if (entry.snapshotEncryptionKey != undefined) {
            const bytes: Buffer = Buffer.from(await encryptionService.masterDecrypt(entry.snapshotEncryptionKey), 'base64');
            if (bytes.length !== this.encryptionBytes) {
                throw new InternalError(
                    `The key of the snapshot ${entry.snapshotPath} is ${bytes.length} bytes, `
                    + `where it needs to be ${this.encryptionBytes}.`
                );
            }
            encryption = { key: bytes.subarray(0, this.keyBytes), iv: bytes.subarray(this.keyBytes) };
        }
        // a release that noted no compression stored its snapshots as they were handed over
        return { path: entry.snapshotPath, compression: entry.snapshotCompression ?? 'none', encryption };
    }

    /**
     * Writes a journal.
     * @param p - The path of the journal.
     * @param journal - What it holds.
     */
    static async write(p: FsPath, journal: RestoreJournal): Promise<void> {
        // written beside it and renamed over it, which replaces the file in one step: a process killed
        // while writing leaves the journal as it was before or after, never half of one
        const writing: FsPath = FsUtilities.getPath(`${p}.writing`);
        await FsUtilities.upsertFile(writing, JsonUtilities.stringify(journal));
        // on the disk before it takes the journal's place, so that a machine going down right after
        // the rename finds the journal written rather than an empty file under its name
        await FsUtilities.sync(writing);
        await FsUtilities.rename(writing, p);
    }
}