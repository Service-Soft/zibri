/* eslint-disable jsdoc/require-jsdoc */
import { LoggedError } from './logged-error.model';
import { JsonUtilities } from '../utilities/json.utilities';

export function errorToLoggedError(error: Error): LoggedError {
    const res: LoggedError = {
        name: error.name,
        paragraphs: errorToParagraphs(error),
        stackTrace: errorToStackTrace(error)
    };
    return res;
}

// the stacks of the causes as well: Error.stack never names the cause, so this is the only place they are kept
function errorToStackTrace(error: Error, indent: string = ''): string[] {
    const stackTrace: string[] = error.stack?.split('\n').map(line => `${indent}${line}`) ?? [];
    if (error.cause instanceof Error && error.cause.stack) {
        const newIndent: string = indent + '    ';
        stackTrace.push(`${newIndent}caused by:`, ...errorToStackTrace(error.cause, newIndent));
    }
    return stackTrace;
}

function errorToParagraphs(error: Error, indent: string = ''): string[] {
    const paragraphs: string[] = [];
    if ('paragraphs' in error) {
        paragraphs.push(...(error.paragraphs as string[]).map(p => `${indent}${p}`));
    }
    else {
        paragraphs.push(...error.message.split('\n').map(p => `${indent}${p}`));
    }

    const newIndent: string = indent + '    ';
    if (error.cause != undefined) {
        if (error.cause instanceof Error) {
            paragraphs.push(`${newIndent}caused by ${error.cause.name}:`);
            paragraphs.push(...errorToParagraphs(error.cause, newIndent));
        }
        else {
            paragraphs.push(`${newIndent}caused by:`, ...JsonUtilities.stringify(error.cause, undefined, 2).split('\n'));
        }
    }

    return paragraphs;
}