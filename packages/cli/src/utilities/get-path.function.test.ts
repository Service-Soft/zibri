import path from 'path';

import { afterEach, describe, expect, it } from '@jest/globals';

import { getPath } from './get-path.function';
import { CPUtilities } from '../encapsulation';

/**
 * A path written with slashes, as the platform writes it: with backslashes on windows.
 * @param slashed - The path, with slashes.
 * @returns It, with the platform's separator.
 */
function native(slashed: string): string {
    return slashed.replaceAll('/', path.sep);
}

describe('getPath', () => {
    afterEach(() => {
        CPUtilities['cwd'] = undefined;
    });

    it('joins the given path segments', () => {
        expect(getPath('foo', 'bar')).toBe(native('foo/bar'));
    });

    it('returns absolute paths unchanged', () => {
        expect(getPath('/foo/bar')).toBe(native('/foo/bar'));
    });

    it('resolves relative paths against CPUtilities.cwd when set (used for testing/mocking)', () => {
        CPUtilities['cwd'] = '/tmp/some-dir';
        expect(getPath('foo', 'bar')).toBe(native('/tmp/some-dir/foo/bar'));
    });
});