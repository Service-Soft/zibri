import { describe, expect, it } from 'vitest';

import { horizontalPadding, resolvePadding } from './dimensions.ts';

describe('resolvePadding', () => {
    it('returns the shorthand unchanged when nothing is overridden', () => {
        expect(resolvePadding('10px 25px', {})).toBe('10px 25px');
    });

    it('expands and overrides one side', () => {
        expect(resolvePadding('10px 25px', { bottom: '0px' })).toBe('10px 25px 0px 25px');
    });

    it('expands a single value before overriding', () => {
        expect(resolvePadding('5px', { top: '20px' })).toBe('20px 5px 5px 5px');
    });

    it('overrides several sides', () => {
        expect(resolvePadding('10px 25px', { top: '0px', bottom: '40px' })).toBe('0px 25px 40px 25px');
    });
});

describe('horizontalPadding', () => {
    it('doubles a single value', () => {
        expect(horizontalPadding('10px')).toBe(20);
    });

    it('takes the horizontal of a two-value shorthand', () => {
        expect(horizontalPadding('10px 25px')).toBe(50);
    });

    it('sums left and right of a four-value shorthand', () => {
        expect(horizontalPadding('10px 20px 30px 40px')).toBe(60);
    });
});