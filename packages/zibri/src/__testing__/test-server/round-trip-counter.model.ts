/**
 * Counts how often a data source talks to its store.
 *
 * Handed to a test data source, which records one round trip per statement on sql and one per client
 * call on valkey, where a batch or a script is one call. What it measures is the cost a call has
 * whatever machine runs it, which a timing does not: a threshold over a few hundred rows passes on a
 * fast container and catches nothing.
 */
export class RoundTripCounter {
    private recorded: number = 0;

    /**
     * How many round trips were recorded since the last reset.
     * @returns The count.
     */
    get count(): number {
        return this.recorded;
    }

    /**
     * Records one round trip.
     */
    record(): void {
        this.recorded++;
    }

    /**
     * Starts counting from zero again.
     */
    reset(): void {
        this.recorded = 0;
    }

    /**
     * Counts the round trips the given work causes.
     * @param work - The work to measure.
     * @returns How many round trips it caused.
     */
    async resolveCountOf(work: () => Promise<unknown>): Promise<number> {
        this.reset();
        await work();
        return this.recorded;
    }
}