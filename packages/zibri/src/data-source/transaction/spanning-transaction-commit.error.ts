import { SpanningTransactionRestoreFailure } from './spanning-transaction-restore-failure.model';
import { InternalError } from '../../error-handling/internal-error.model';

/**
 * Thrown when a spanning transaction could not commit in one of the data sources it spans.
 *
 * Its writes are undone everywhere: the data sources that had not committed yet are rolled back, and
 * the ones that had are restored to the rows they held before. `restoreFailures` names every data
 * source whose restore failed, where the rows stay as the transaction wrote them.
 */
export class SpanningTransactionCommitError extends InternalError {
    constructor(
        /**
         * The name of the data source whose commit failed.
         */
        readonly dataSourceName: string,
        /**
         * The data sources whose restore failed, empty when every one was restored.
         */
        readonly restoreFailures: SpanningTransactionRestoreFailure[],
        options: ErrorOptions
    ) {
        super([
            `The spanning transaction could not commit in the data source "${dataSourceName}", so it was undone in every data source.`,
            ...restoreFailures.map(failure => `  - restoring "${failure.dataSourceName}" failed, its rows stay as the transaction wrote them: ${String(failure.error)}`)
        ], options);
        this.name = 'SpanningTransactionCommitError';
    }
}
