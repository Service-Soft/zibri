import { InternalError } from '../../error-handling/internal-error.model';
import { type MissingFrameworkColumn } from './missing-framework-column.model';

/**
 * Thrown when something needs a column the framework added to one of its entities, which the database of a data
 * source with `schemaManagement: 'external'` lacks. Names the columns, and the statements that add them.
 */
export class MissingFrameworkColumnError extends InternalError {
    /**
     * The columns that are missing.
     */
    readonly columns: readonly MissingFrameworkColumn[];

    constructor(feature: string, columns: readonly MissingFrameworkColumn[]) {
        super([
            `${feature} needs ${columns.map(c => `the column "${c.column}" of "${c.table}"`).join(', ')}, which the database lacks.`,
            'The data source issues no DDL with schemaManagement: \'external\'. Add the columns, and start the application again:',
            ...columns.flatMap(c => c.statements.map(statement => `${statement};`))
        ]);
        this.columns = columns;
    }
}
