import { DiVariant } from '../di/models/di-variant.model';
import { type KeptRowDivergence } from './kept-row-divergence.model';

/**
 * Finds the rows of the active tenant that are kept as they were written, such as by being append only or chained,
 * and no longer match the rows they were written from. A restore of a tenant keeps those rows and brings back the
 * others, and asks every check registered with {@link KEPT_ROW_CHECK_DI_VARIANT} once it is done.
 */
export interface KeptRowCheckInterface {
    /**
     * Resolves the kept rows of the active tenant that no longer match the rows they were written from. Changes
     * nothing.
     * @returns The rows, none when every one matches.
     */
    resolveKeptRowDivergences: () => Promise<KeptRowDivergence[]>
}

/**
 * The variant of the providers of the checks a restore of a tenant asks once it is done, such as those of the
 * bookkeeping, the invoicing and the bank plugin. Each implements `KeptRowCheckInterface`.
 */
export const KEPT_ROW_CHECK_DI_VARIANT: DiVariant = new DiVariant('kept-row-check');