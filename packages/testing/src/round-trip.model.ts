/**
 * One request a data source sent to its store, as a RoundTripCounter recorded it.
 */
export type RoundTrip = {
    /**
     * What was sent: the statement on sql, the client call on valkey, the driver call in memory.
     */
    statement: string,
    /**
     * The repository calls it was sent from, outermost first, eg.
     * `ChangeSetRepository.updateById > Repository.saveUpdate`.
     */
    origin: string[]
};