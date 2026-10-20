import { describe, expect, it } from 'vitest';

import { Bytes } from './bytes.ts';

describe('Bytes', () => {
    it('defines each unit as the correct multiple of bytes', () => {
        expect(Bytes.B).toBe(1);
        expect(Bytes.KB).toBe(1000);
        expect(Bytes.MB).toBe(1_000_000);
        expect(Bytes.GB).toBe(1_000_000_000);
    });
});