import { InternalError } from '../../../error-handling/internal-error.model';

/**
 * Collects the values of a raw sql statement so that they are bound instead of written into it.
 *
 * A statement built by concatenation is only ever as safe as the escaping of every value that went
 * into it, and it also loses prepared statement plan caching. Everything a caller supplied - values,
 * ids, json keys - goes through here and reaches the statement as a placeholder, so nothing the
 * caller wrote can change what the statement says.
 *
 * The `:name` placeholder is typeorm's own convention rather than any one dialect's, so this works
 * for every driver: postgres turns it into `$1`, mysql and mariadb turn it into `?`. What is
 * dialect specific is the sql around it, which is why this lives on the shared converter and the
 * casts do not.
 *
 * The names have to be unique across the whole query rather than across one condition, because
 * typeorm merges the parameters of every raw operator into one set. The converter therefore owns
 * the numbering and hands it in.
 */
export class TypeOrmParameters {

    /**
     * The values to bind, keyed by the name that stands in for them in the statement.
     */
    readonly values: Record<string, unknown> = {};

    constructor(private readonly nextName: () => string) {}

    /**
     * Registers a value and returns the placeholder that stands in for it.
     * @param value - The value to bind.
     * @returns The placeholder to write into the statement.
     * @throws When the value is not something a database column can hold.
     */
    add(value: unknown): string {
        this.validateBindable(value);
        const name: string = this.nextName();
        this.values[name] = value;
        return `:${name}`;
    }

    /**
     * Registers a list of values as one value and returns the placeholder that stands in for it.
     *
     * For a dialect that binds a list as a single value, where a statement then binds one value
     * however long the list is.
     * @param values - The values to bind together.
     * @returns The placeholder to write into the statement.
     * @throws When one of the values is not something a database column can hold.
     */
    addList(values: unknown[]): string {
        // a statement binds a bounded number of values - 65535 on postgres - and a list is as long as
        // whoever wrote the filter made it, so binding it value by value fails past a length nobody chose
        for (const value of values) {
            this.validateBindable(value);
        }
        const name: string = this.nextName();
        this.values[name] = values;
        return `:${name}`;
    }

    private validateBindable(value: unknown): void {
        if (
            value !== null && typeof value !== 'string' && typeof value !== 'number'
            && typeof value !== 'boolean' && !(value instanceof Date)
        ) {
            throw new InternalError(`Cannot use a value of type "${typeof value}" in a sql statement`);
        }
    }
}