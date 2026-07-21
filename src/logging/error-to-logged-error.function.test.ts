import { describe, expect, it } from '@jest/globals';

import { errorToLoggedError } from './error-to-logged-error.function';
import { LoggedError } from './logged-error.model';

describe('errorToLoggedError', () => {
    it('converts a plain error into paragraphs and a stack trace', () => {
        const error: Error = new Error('something went wrong');
        const result: LoggedError = errorToLoggedError(error);

        expect(result.name).toBe('Error');
        expect(result.paragraphs).toContain('something went wrong');
        expect(result.paragraphs).toContain('stack trace:');
        expect(result.stackTrace.length).toBeGreaterThan(0);
        expect(result.stackTrace[0]).toContain('Error: something went wrong');
    });

    it('splits a multi-line message into separate paragraphs', () => {
        const error: Error = new Error('line one\nline two');
        const result: LoggedError = errorToLoggedError(error);

        expect(result.paragraphs).toContain('line one');
        expect(result.paragraphs).toContain('line two');
    });

    it('uses an existing "paragraphs" property instead of the message when present', () => {
        const error: Error & { paragraphs: string[] } = Object.assign(new Error('ignored message'), {
            paragraphs: ['custom paragraph 1', 'custom paragraph 2']
        });
        const result: LoggedError = errorToLoggedError(error);

        expect(result.paragraphs).toContain('custom paragraph 1');
        expect(result.paragraphs).toContain('custom paragraph 2');
        expect(result.paragraphs).not.toContain('ignored message');
    });

    it('nests the cause chain when the cause is an Error, indenting each level', () => {
        const cause: Error = new Error('the root cause');
        cause.name = 'RootCauseError';
        const error: Error = new Error('the outer error', { cause });

        const result: LoggedError = errorToLoggedError(error);

        expect(result.paragraphs).toContain('the outer error');
        expect(result.paragraphs.some(p => p.includes('caused by RootCauseError:'))).toBe(true);
        expect(result.paragraphs.some(p => p.trim() === 'the root cause')).toBe(true);
    });

    it('serializes a non-Error cause as JSON', () => {
        const error: Error = new Error('outer', { cause: { code: 'SOME_CODE', detail: 42 } });

        const result: LoggedError = errorToLoggedError(error);

        expect(result.paragraphs.some(p => p.includes('caused by:'))).toBe(true);
        expect(result.paragraphs.some(p => p.includes('"code": "SOME_CODE"'))).toBe(true);
    });

    it('handles an error with no stack trace gracefully', () => {
        const error: Error = new Error('no stack');
        delete error.stack;

        const result: LoggedError = errorToLoggedError(error);

        expect(result.stackTrace).toEqual([]);
    });
});