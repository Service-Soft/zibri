/**
 * A data source whose rows could not be restored after a spanning transaction failed to commit.
 */
export type SpanningTransactionRestoreFailure = {
    /**
     * The name of the data source, whose rows stay as the transaction wrote them.
     */
    dataSourceName: string,
    /**
     * What the restore failed with.
     */
    error: unknown
};
