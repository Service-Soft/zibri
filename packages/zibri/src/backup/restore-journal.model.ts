import { RestoreJournalEntry } from './restore-journal-entry.model';

/**
 * What a restore in progress has applied, kept on disk beside its snapshots.
 */
export type RestoreJournal = {
    /**
     * The name of the backup being restored.
     */
    backupName: string,
    /**
     * The resources it started applying, in the order it did.
     */
    applied: RestoreJournalEntry[]
};