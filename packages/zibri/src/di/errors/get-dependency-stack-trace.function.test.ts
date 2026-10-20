import { describe, expect, it } from 'vitest';

import { getDependencyStackTrace } from './get-dependency-stack-trace.function.ts';
import { Injectable } from '../decorators/injectable.decorator.ts';

class First {}

class Second {}

@Injectable({ register: 'onUse' })
class Decorated {}

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
        const result: string = getDependencyStackTrace('SomeError', 'msg', [Decorated]);
        expect(result).toContain(`at Decorated (${import.meta.filename})`);
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