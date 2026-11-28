import { Readable } from 'node:stream';

import { Transaction } from '../data-source/transaction/transaction.model';
import { Newable } from '../types/newable.type';
import { ArchiveVerification } from './archive-verification.model';
import { BaseArchivedEntity } from './base-archived-entity.model';

/**
 * What the archive fills in on a row about to be created.
 */
export type ArchiveData = Pick<BaseArchivedEntity, 'retainUntil' | 'archivedFiles'>;

/**
 * Which part of the archive `resolveVerification` checks.
 */
export type ArchiveVerificationOptions = {
    /**
     * The archived entity to check. Every one the data sources declare by default.
     */
    entityClass?: Newable<BaseArchivedEntity>,
    /**
     * The tenant whose chain and files are checked. Every tenant, and the rows of no tenant, by default.
     */
    tenantId?: string
};

/**
 * Which rows `findDue` finds.
 */
export type ArchiveFindDueOptions = {
    /**
     * How many rows at most. 100 by default.
     */
    limit?: number,
    /**
     * Whether the rows of every tenant are found, not only those of the current one. Off by default.
     */
    acrossTenants?: boolean
};

/**
 * Keeps the rows of the entities declared with `@Archive` and their files: counts when the retention of a row ends,
 * copies its files into the stores the archive names, checks the chains and the files, and prunes the rows whose
 * retention ended.
 */
export interface ArchiveServiceInterface {
    /**
     * Resolves what the archive fills in on rows about to be created: when the retention of each ends, unless it is
     * created with a `retainUntil` of its own, and its files, each copied into the stores `copies` names. The
     * repository calls it while it writes them, before their chain links.
     */
    resolveArchiveData: (
        entityClass: Newable<BaseArchivedEntity>,
        rows: object[],
        transaction: Transaction | undefined
    ) => Promise<ArchiveData[]>,
    /**
     * Resolves whether the archive holds: every chain intact, and the bytes of every file and copy matching the
     * SHA-256 its row recorded.
     */
    resolveVerification: (options?: ArchiveVerificationOptions) => Promise<ArchiveVerification>,
    /**
     * Finds the rows whose retention ended, the longest ended first.
     */
    findDue: <T extends BaseArchivedEntity>(entityClass: Newable<T>, options?: ArchiveFindDueOptions) => Promise<T[]>,
    /**
     * Deletes every row whose retention ended, of every tenant, with its files and their copies. Resolves how many rows
     * were deleted.
     * @param entityClass - The archived entity. Every one the data sources declare by default.
     */
    prune: (entityClass?: Newable<BaseArchivedEntity>) => Promise<number>,
    /**
     * Reads a file of a row of the current tenant from the first of the file and its copies whose bytes match their
     * SHA-256. The bytes are checked before the stream is handed over.
     * @param row - The row.
     * @param fileId - The id of the file, as a file property of the row holds it.
     * @throws What reading the last copy failed with, when none matches.
     */
    readFile: (row: BaseArchivedEntity, fileId: string) => Promise<Readable>
}