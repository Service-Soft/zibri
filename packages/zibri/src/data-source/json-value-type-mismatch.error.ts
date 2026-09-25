import { InternalError } from '../error-handling/internal-error.model';

/**
 * What a filter found in a json column that the property it belongs to does not describe.
 */
export type MistypedJsonValue = {
    /**
     * The path to the property, starting at the table the query gave the column: eg.
     * `sensor_1.reading.value`.
     */
    path: string,
    /**
     * The type the property declares.
     */
    declaredType: string,
    /**
     * The value the row holds instead.
     */
    value: string
};

/**
 * An error for a value inside a json column that is not of the type its property declares.
 *
 * A json column is the one place where a row can hold something the model does not describe, because
 * a column type says only that the value is json and nothing about what is in it. Every other column
 * is checked by the database on the way in, so this is where a type declared in the application and
 * the data actually stored can drift apart - a property that used to be a string and is a number now
 * leaves the rows written before the change behind.
 *
 * Raised rather than answered with "no match", because a row that cannot be compared is not a row
 * that failed the comparison: reading it as one would quietly shrink the answer to every filter that
 * touches the property, and the rows left out are exactly the ones worth knowing about.
 */
export class JsonValueTypeMismatchError extends InternalError {

    /**
     * The path to the property, starting at the entity: eg. `Sensor.reading.value`.
     */
    readonly path: string;

    constructor(entityName: string, mistyped: MistypedJsonValue, options?: ErrorOptions) {
        // the entity in place of the name the statement gave its table, which is the same thing to
        // the database and not to whoever wrote the model the rest of the path is spelled in
        const path: string = [entityName, ...mistyped.path.split('.').slice(1)].join('.');
        super(
            `${path} is declared as a ${mistyped.declaredType}, but a row holds ${JSON.stringify(mistyped.value)}.`
            + ' Every row has to hold the declared type for a filter to compare it.',
            options
        );
        this.name = 'JsonValueTypeMismatchError';
        this.path = path;
    }
}