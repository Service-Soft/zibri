import { RestoreJournal } from './restore-journal.model';
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
     * Writes a journal.
     * @param p - The path of the journal.
     * @param journal - What it holds.
     */
    static async write(p: FsPath, journal: RestoreJournal): Promise<void> {
        // written beside it and renamed over it, which replaces the file in one step: a process killed
        // while writing leaves the journal as it was before or after, never half of one
        const writing: FsPath = FsUtilities.getPath(`${p}.writing`);
        await FsUtilities.upsertFile(writing, JsonUtilities.stringify(journal));
        await FsUtilities.rename(writing, p);
    }
}