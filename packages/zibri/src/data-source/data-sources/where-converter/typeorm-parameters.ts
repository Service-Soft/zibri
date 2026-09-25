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
        if (
            value !== null && typeof value !== 'string' && typeof value !== 'number'
            && typeof value !== 'boolean' && !(value instanceof Date)
        ) {
            throw new InternalError(`Cannot use a value of type "${typeof value}" in a sql statement`);
        }

        const name: string = this.nextName();
        this.values[name] = value;
        return `:${name}`;
    }
}