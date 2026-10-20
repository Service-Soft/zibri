import { RoundTrip } from './round-trip.model.ts';

/**
 * How many frames of the stack are read to find the repository calls a round trip came from. A
 * write going through the repositories of the rows beside it is easily deeper than the default ten.
 */
const ORIGIN_STACK_FRAMES: number = 200;

/**
 * Counts how often a data source talks to its store, and records what each request was.
 *
 * Handed to a test data source, which records one round trip per statement on sql, one per client
 * call on valkey, where a batch or a script is one call, and one per driver call in memory. What it
 * measures is the cost a call has whatever machine runs it, which a timing does not: a threshold over
 * a few hundred rows passes on a fast container and catches nothing.
 *
 * When a count is not what it should be, describe lists each round trip with the repository
 * calls it came from.
 */
export class RoundTripCounter {
    private readonly recorded: RoundTrip[] = [];

    /**
     * How many round trips were recorded since the last reset.
     * @returns The count.
     */
    get count(): number {
        return this.recorded.length;
    }

    /**
     * The round trips recorded since the last reset, in the order they were sent.
     * @returns The round trips.
     */
    get trips(): readonly RoundTrip[] {
        return this.recorded;
    }

    /**
     * Records one round trip, with the repository calls it was sent from.
     * @param statement - What was sent.
     */
    record(statement: string): void {
        this.recorded.push({ statement, origin: this.resolveOrigin() });
    }

    /**
     * Starts counting from zero again.
     */
    reset(): void {
        this.recorded.length = 0;
    }

    /**
     * Counts the round trips the given work causes.
     * @param work - The work to measure.
     * @returns How many round trips it caused.
     */
    async resolveCountOf(work: () => Promise<unknown>): Promise<number> {
        this.reset();
        await work();
        return this.count;
    }

    /**
     * Lists the round trips recorded since the last reset, one per line with the repository calls
     * it came from beneath it.
     * @returns The list, to print or to compare.
     */
    describe(): string {
        return this.recorded
            .map((trip, i) => `${i + 1}. ${trip.statement}\n   ${trip.origin.join(' > ')}`)
            .join('\n');
    }

    /**
     * Resolves the repository calls the current round trip was sent from, from the stack.
     *
     * Async frames are on it as long as every caller awaits, which every repository does. A method
     * calling itself - a write wrapping itself in a transaction - is named once.
     * @returns The calls, outermost first.
     */
    private resolveOrigin(): string[] {
        const limit: number = Error.stackTraceLimit;
        Error.stackTraceLimit = ORIGIN_STACK_FRAMES;
        const stack: string = new Error('origin').stack ?? '';
        Error.stackTraceLimit = limit;

        const res: string[] = [];
        for (const line of stack.split('\n').reverse()) {
            const call: string | undefined = /at (?:async )?(\w*Repository\.\w+) /.exec(line)?.[1];
            if (call != undefined && res.at(-1) !== call) {
                res.push(call);
            }
        }
        return res;
    }
}