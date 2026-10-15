import { InternalError } from '../error-handling/internal-error.model';
import { JsonUtilities } from '../utilities/json.utilities';

/**
 * What a filter found in a row that the property it belongs to does not describe.
 */
export type MistypedStoredValue = {
    /**
     * The path to the property, starting at the entity: eg. `Sensor.reading.value`.
     */
    path: string,
    /**
     * The type the property declares.
     */
    declaredType: string,
    /**
     * The value the row holds instead, as text.
     */
    value: string
};

/**
 * An error for a stored value that is not of the type its property declares.
 *
 * A declaration can change after rows were written, and the rows written before the change keep the
 * value they were written with - a property that used to be a string and is a number now leaves
 * strings behind.
 *
 * Raised rather than answered with "no match", because a row that cannot be compared is not a row
 * that failed the comparison: reading it as one would quietly shrink the answer to every filter that
 * touches the property, and the rows left out are exactly the ones worth knowing about.
 */
export class StoredValueTypeMismatchError extends InternalError {

    /**
     * The path to the property, starting at the entity: eg. `Sensor.reading.value`.
     */
    readonly path: string;

    constructor(mistyped: MistypedStoredValue, options?: ErrorOptions) {
        super(
            `${mistyped.path} is declared as a ${mistyped.declaredType}, but a row holds ${JsonUtilities.stringify(mistyped.value)}.`
            + ' Every row has to hold the declared type for a filter to compare it.',
            options
        );
        this.name = 'StoredValueTypeMismatchError';
        this.path = mistyped.path;
    }
}