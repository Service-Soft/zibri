import { describe, expect, it } from 'vitest';

import { createServerRuntime, RenderServerRuntime } from './server-runtime.ts';

describe('runtime collect/collected', () => {
    it('records values in first-seen order, de-duplicated', () => {
        const runtime: RenderServerRuntime = createServerRuntime();
        runtime.collect('c', '100');
        runtime.collect('c', '50');
        runtime.collect('c', '100');
        expect(runtime.collected('c')).toEqual(['100', '50']);
    });

    it('keeps channels separate', () => {
        const runtime: RenderServerRuntime = createServerRuntime();
        runtime.collect('a', '1');
        runtime.collect('b', '2');
        expect(runtime.collected('a')).toEqual(['1']);
        expect(runtime.collected('b')).toEqual(['2']);
    });

    it('returns nothing for an untouched channel', () => {
        expect(createServerRuntime().collected('missing')).toEqual([]);
    });

    it('is isolated per render', () => {
        const first: RenderServerRuntime = createServerRuntime();
        first.collect('c', '1');
        expect(createServerRuntime().collected('c')).toEqual([]);
    });
});