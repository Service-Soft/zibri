import { InternalError } from '../error-handling/internal-error.model';

/**
 * What a failed statement is described by.
 */
export type FailedStatement = {
    /**
     * What the database answered.
     */
    message: string,
    /**
     * What it added to its answer, when it added anything.
     */
    detail: string | undefined,
    /**
     * The statement.
     */
    query: string,
    /**
     * The values it bound.
     */
    parameters: unknown[]
};

/**
 * An error for a failed sql query.
 */
export class QueryFailedError extends InternalError {
    constructor(failed: FailedStatement, options?: ErrorOptions) {
        super(buildErrorMessage(failed), options);
        this.name = 'QueryFailedError';
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function buildErrorMessage(failed: FailedStatement): string {
    let query: string = failed.query;
    for (const [i, parameter] of failed.parameters.entries()) {
        query = query.replace(`$${i + 1}`, String(parameter));
    }

    if (query.includes(' VALUES ')) {
        const parts: string[] = query.split(' VALUES ');
        query = `${parts[0]}\nVALUES ${parts[1]}`;
    }

    let message: string = failed.message;
    const detail: string | undefined = failed.detail;
    if (message.includes('duplicate key value violates unique constraint') && detail != undefined) {
        const key: string = detail.split('Key (').at(1)
            ?.split(')=')
            .at(0) ?? '';
        message = message.replace(
            'duplicate key value violates unique constraint',
            `duplicate value for property "${key}" violates unique constraint`
        );
    }
    if (message.includes('violates foreign key constraint') && detail != undefined) {
        // Example: "Key (id)=(a1b2c3d4-...) is still referenced from table "user_groups_group"."
        // Read from the start only: the value is written out as it was sent, and one repeating "Key ("
        // after a line break would be read again from every repetition to the end of its line
        const keyMatch: RegExpMatchArray | null = detail.match(/^Key \((.+?)\)=\((.+?)\)/);
        const tableMatch: RegExpMatchArray | null = detail.match(/table "(.+?)"/);
        const key: string | undefined = keyMatch?.[1];
        const value: string | undefined = keyMatch?.[2];
        const referencingTable: string | undefined = tableMatch?.[1];
        if (key != undefined && value != undefined && referencingTable != undefined) {
            message = message.replace(
                'violates foreign key constraint',
                [
                    'violates foreign key constraint:',
                    `cannot delete or update because ${referencingTable}.${key} still references this row (value = ${value})`
                ].join('\n')
            );
        }
    }

    return [
        message,
        'SQL:',
        query
    ].join('\n');
}