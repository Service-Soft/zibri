import { describe, expect, it } from '@jest/globals';

import { getDependencyStackTrace } from './get-dependency-stack-trace.function';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

class First {}

class Second {}

describe('getDependencyStackTrace', () => {
    it('prepends the error name and message and lists the stack in reverse order', () => {
        const result: string = getDependencyStackTrace('NoProviderError', 'something went wrong', [First, Second]);
        const lines: string[] = result.split('\n');
        expect(lines[0]).toBe('NoProviderError: something went wrong');
        expect(lines[1]).toBe('Dependency resolution stack:');
        expect(lines[2]).toContain('Second');
        expect(lines[3]).toContain('First');
    });

    it('falls back to "unknown" for a function with no recorded file path', () => {
        const result: string = getDependencyStackTrace('SomeError', 'msg', [First]);
        expect(result).toContain('at First (unknown)');
    });

    it('includes the recorded file path when the target was decorated', () => {
        // eslint-disable-next-line unicorn/error-message
        MetadataUtilities.setFilePath(Second, new Error().stack ?? '');
        const result: string = getDependencyStackTrace('SomeError', 'msg', [Second]);
        expect(result).toContain('at Second (');
        expect(result).not.toContain('at Second (unknown)');
    });

    it('labels anonymous functions', () => {
        const anonymous: Function = function(): void {};
        Object.defineProperty(anonymous, 'name', { value: '' });
        const result: string = getDependencyStackTrace('SomeError', 'msg', [anonymous]);
        expect(result).toContain('at <anonymous> (unknown)');
    });

    it('returns just the header when the stack is empty', () => {
        const result: string = getDependencyStackTrace('SomeError', 'msg', []);
        expect(result).toBe('SomeError: msg\nDependency resolution stack:');
    });
});