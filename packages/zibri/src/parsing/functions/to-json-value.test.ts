import { describe, expect, it } from 'vitest';

import { toJsonValue } from './to-json-value.function.ts';
import { BigNumber } from '../../utilities/number.utilities.ts';

describe('toJsonValue', () => {
    it('writes what json has no shape for as the text it reads as', () => {
        expect(toJsonValue(10n)).toBe('10');
        expect(toJsonValue(new Date('2024-03-01T10:15:30.000Z'))).toBe('2024-03-01T10:15:30.000Z');
        expect(toJsonValue(new BigNumber('10.5'))).toBe('10.5');
    });

    it('writes an exact decimal in full rather than as an exponent', () => {
        expect(toJsonValue(new BigNumber('1e+25'))).toBe('10000000000000000000000000');
    });

    it('leaves what json already carries alone', () => {
        expect(toJsonValue('text')).toBe('text');
        expect(toJsonValue(10.5)).toBe(10.5);
        expect(toJsonValue(true)).toBe(true);
        // eslint-disable-next-line unicorn/no-null
        expect(toJsonValue(null)).toBeNull();
        expect(toJsonValue(undefined)).toBeUndefined();
    });

    it('converts every level, not only the value it is given', () => {
        const value: unknown = toJsonValue({
            serial: 9007199254740993n,
            samples: [{ takenAt: new Date('2024-03-01T10:15:30.000Z'), tolerance: new BigNumber('0.5') }]
        });

        expect(value).toEqual({
            serial: '9007199254740993',
            samples: [{ takenAt: '2024-03-01T10:15:30.000Z', tolerance: '0.5' }]
        });
    });

    it('writes a value json would have thrown over', () => {
        expect(() => JSON.stringify({ serial: 10n })).toThrow(TypeError);
        expect(JSON.stringify(toJsonValue({ serial: 10n }))).toBe('{"serial":"10"}');
    });
});