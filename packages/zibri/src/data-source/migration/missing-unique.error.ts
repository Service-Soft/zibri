import { InternalError } from '../../error-handling/internal-error.model';
import { MissingUnique } from './missing-unique.model';

/**
 * Thrown by an upsert identifying its rows by a unique the database lacks, with `schemaManagement: 'external'`.
 */
export class MissingUniqueError extends InternalError {
    /**
     * The unique that is missing.
     */
    readonly unique: MissingUnique;

    constructor(feature: string, unique: MissingUnique) {
        super([
            `${feature} needs the unique "${unique.name}" of "${unique.table}", which the database lacks.`,
            'The data source issues no DDL with schemaManagement: \'external\'. Add the unique, and start the application again:',
            ...unique.statements.map(statement => `${statement};`)
        ]);
        this.name = 'MissingUniqueError';
        this.unique = unique;
    }
}