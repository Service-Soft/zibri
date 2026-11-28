import { ChainVerification } from '../data-source/chain/chain-verification.model';

/**
 * What checking the chain of one tenant of an archived entity found.
 */
export type ArchivedChainVerification = {
    /**
     * The name of the archived entity.
     */
    entityName: string,
    /**
     * The tenant of the chain, or undefined for the rows of no tenant.
     */
    tenantId: string | undefined,
    /**
     * What checking the chain found.
     */
    verification: ChainVerification
};

/**
 * What is wrong with a file: `'missing'` when its `FileRecord` is gone, `'changed'` when the record or the bytes do
 * not match the SHA-256 the row recorded, and `'unreadable'` when its store does not hand the bytes over.
 */
export type ArchivedFileProblemReason = 'missing' | 'changed' | 'unreadable';

/**
 * A file of a row of an archived entity, or a copy of it, that does not hold.
 */
export type ArchivedFileProblem = {
    /**
     * The name of the archived entity.
     */
    entityName: string,
    /**
     * The tenant of the row, or undefined for a row of no tenant.
     */
    tenantId: string | undefined,
    /**
     * The id of the row.
     */
    rowId: string,
    /**
     * The id of the `FileRecord` of the file, or of the copy.
     */
    fileId: string,
    /**
     * What is wrong with it.
     */
    reason: ArchivedFileProblemReason,
    /**
     * What is wrong with it, in words.
     */
    message: string
};

/**
 * What checking the archive found: every chain, and every file and copy that does not hold.
 */
export type ArchiveVerification = {
    /**
     * Whether every chain is intact and every file holds.
     */
    intact: boolean,
    /**
     * What checking each chain found.
     */
    chains: ArchivedChainVerification[],
    /**
     * The files and copies that do not hold.
     */
    fileProblems: ArchivedFileProblem[],
    /**
     * How many files and copies were read.
     */
    checkedFiles: number
};