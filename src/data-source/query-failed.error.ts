import { QueryFailedError as TOQueryFailedError } from 'typeorm';

/**
 *
 */
export class QueryFailedError extends Error {
    constructor(error: TOQueryFailedError<Error>) {
        super(buildErrorMessage(error));
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

    return [
        error.message,
        'SQL:',
        query
    ].join('\n');
}