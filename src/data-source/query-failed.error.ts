import { QueryFailedError as TOQueryFailedError } from 'typeorm';

import { InternalError } from '../error-handling/internal-error.model';

/**
 * An error for a failed sql query.
 */
export class QueryFailedError extends InternalError {
    constructor(error: TOQueryFailedError<Error>, options?: ErrorOptions) {
        super(buildErrorMessage(error), options);
        // this.stack = error.stack;
        this.name = 'QueryFailedError';
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function buildErrorMessage(error: TOQueryFailedError): string {
    let query: string = error.query;
    for (let i: number = 0; i < (error.parameters ?? []).length; i++) {
        // eslint-disable-next-line typescript/no-non-null-assertion
        const parameter: unknown = error.parameters![i];
        query = query.replace(`$${i + 1}`, String(parameter));
    }

    if (query.includes(' VALUES ')) {
        const parts: string[] = query.split(' VALUES ');
        query = `${parts[0]}\nVALUES ${parts[1]}`;
    }

    let message: string = error.message;
    if (
        message.includes('duplicate key value violates unique constraint')
        && 'detail' in error.driverError
        && typeof error.driverError.detail === 'string'
    ) {
        const key: string = error.driverError.detail.split('Key (').at(1)
            ?.split(')=')
            .at(0) ?? '';
        message = message.replace(
            'duplicate key value violates unique constraint',
            `duplicate value for property "${key}" violates unique constraint`
        );
    }
    if (
        message.includes('violates foreign key constraint')
        && 'detail' in error.driverError
        && typeof error.driverError.detail === 'string'
    ) {
        const detail: string = error.driverError.detail;
        // Example: "Key (id)=(a1b2c3d4-...) is still referenced from table "user_groups_group"."
        const keyMatch: RegExpMatchArray | null = detail.match(/Key \((.+?)\)=\((.+?)\)/);
        const tableMatch: RegExpMatchArray | null = detail.match(/table "(.+?)"/);
        if (keyMatch && tableMatch) {
            const key: string = keyMatch[1];
            const value: string = keyMatch[2];
            const referencingTable: string = tableMatch[1];
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