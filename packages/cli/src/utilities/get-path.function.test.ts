import { afterEach, describe, expect, it } from 'vitest';

import { getPath } from './get-path.function.ts';
import { CPUtilities } from '../encapsulation/index.ts';

describe('getPath', () => {
    afterEach(() => {
        CPUtilities['cwd'] = undefined;
    });

    it('joins the given path segments', () => {
        expect(getPath('foo', 'bar')).toBe('foo/bar');
    });

    it('returns absolute paths unchanged', () => {
        expect(getPath('/foo/bar')).toBe('/foo/bar');
    });

    it('resolves relative paths against CPUtilities.cwd when set (used for testing/mocking)', () => {
        CPUtilities['cwd'] = '/tmp/some-dir';
        expect(getPath('foo', 'bar')).toBe('/tmp/some-dir/foo/bar');
    });
});