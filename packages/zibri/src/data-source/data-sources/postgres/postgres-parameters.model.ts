import { InternalError } from '../../../error-handling/internal-error.model';
import { DataSourceTimeUtilities } from '../../data-source-time.utilities';

/**
 * Collects the values of a statement so that they are bound instead of written into it.
 *
 * A statement built by concatenation is only ever as safe as the escaping of every value that went
 * into it. Everything a caller supplied - values, ids, json keys - goes through here and reaches the
 * statement as a placeholder, so nothing the caller wrote can change what the statement says.
 *
 * The names are unique across the whole statement rather than across one condition, since a
 * statement merges the values of every condition in it. The converter therefore owns the numbering
 * and hands it in.
 */
export class PostgresParameters {

    /**
     * The values to bind, keyed by the name that stands in for them in the statement.
     */
    readonly values: Record<string, unknown> = {};

    constructor(private readonly nextName: () => string) {}

    /**
     * Registers a value and returns the placeholder that stands in for it. A time of the data source
     * is the time of the statement on the server's clock, with its offset bound.
     * @param value - The value to bind.
     * @returns The placeholder to write into the statement.
     */
    add(value: unknown): string {
        if (DataSourceTimeUtilities.isDataSourceTime(value)) {
            // the statement's start rather than now(), which is the start of the transaction and would
            // lag behind by as long as the transaction ran
            return `(statement_timestamp() + ${this.bind(value.dataSourceNowPlusInMs)}::double precision * interval '1 millisecond')`;
        }
        this.validateBindable(value);
        return this.bind(value);
    }

    /**
     * Registers a list of values as one value and returns the placeholder that stands in for it.
     *
     * A statement binds a bounded number of values - 65535 - and a list is as long as whoever wrote
     * the filter made it, so binding it value by value fails past a length nobody chose.
     * @param values - The values to bind together.
     * @returns The placeholder to write into the statement.
     */
    addList(values: unknown[]): string {
        for (const value of values) {
            this.validateBindable(value);
        }
        return this.bind(values);
    }

    private bind(value: unknown): string {
        const name: string = this.nextName();
        this.values[name] = value;
        return `:${name}`;
    }

    private validateBindable(value: unknown): void {
        if (
            value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint'
            && typeof value !== 'boolean' && !(value instanceof Date) && !Buffer.isBuffer(value) && !Array.isArray(value)
        ) {
            throw new InternalError(`Cannot use a value of type "${typeof value}" in a sql statement`);
        }
    }
}