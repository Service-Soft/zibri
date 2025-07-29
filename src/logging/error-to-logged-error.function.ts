/* eslint-disable jsdoc/require-jsdoc */
import { LoggedError } from './logged-error.model';

export function errorToLoggedError(error: Error): LoggedError {
    const res: LoggedError = {
        name: error.name,
        paragraphs: errorToParagraphs(error),
        stackTrace: error.stack?.split('\n') ?? []
    };
    return res;
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
            paragraphs.push(`${newIndent}caused by:`, ...JSON.stringify(error.cause, undefined, 2).split('\n'));
        }
    }

    if (error.stack) {
        paragraphs.push(`${indent}stack trace:`);
        paragraphs.push(...error.stack.split('\n').map(p => `${newIndent}${p}`));
    }

    return paragraphs;
}