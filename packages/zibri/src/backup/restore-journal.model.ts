import { KeptEncryptionKeys } from '../auth/encryption/kept-encryption-keys.model';
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
     * The tenant whose rows the restore replaces, whose snapshots hold that tenant's rows alone. Absent
     * for a restore of the whole application.
     */
    tenantId?: string,
    /**
     * The resources it started applying, in the order it did.
     */
    applied: RestoreJournalEntry[],
    /**
     * The encryption keys stored when it began, which it writes back once it replaced the data source
     * holding them, and the next start writes back when it may not have. Absent for a restore that
     * replaces no such data source.
     */
    keptEncryptionKeys?: KeptEncryptionKeys,
    /**
     * Of each data source it replaces holding entities declared `backedUp: 'keptForCurrentUsers'`, the rows
     * of the users that existed when it began, which it writes back once it replaced the data source, and
     * the next start writes back when it may not have. Absent for a restore that replaces none.
     */
    keptUserRows?: RestoreJournalEntry[]
};