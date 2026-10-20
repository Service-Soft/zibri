import { describe, expect, it } from 'vitest';

import { UUIDUtilities } from './uuid.utilities.ts';

const UUID_V4_REGEX: RegExp = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

describe('UUIDUtilities', () => {
    it('generates a valid v4 uuid', () => {
        expect(UUIDUtilities.generate()).toMatch(UUID_V4_REGEX);
    });

    it('generates a different uuid on each call', () => {
        expect(UUIDUtilities.generate()).not.toBe(UUIDUtilities.generate());
    });

    describe('isUuid', () => {
        it('accepts what generate produces', () => {
            expect(UUIDUtilities.isUuid(UUIDUtilities.generate())).toBe(true);
        });

        it('accepts a uuid whose version digit is not one this framework produces', () => {
            // a v7 id, and the nil uuid. Both are values a uuid column holds, so both have to read
            // back - refusing them here would report a row that exists as absent
            expect(UUIDUtilities.isUuid('01912d68-783e-7000-8000-1f9b0a2c4d5e')).toBe(true);
            expect(UUIDUtilities.isUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
        });

        it('is case insensitive', () => {
            expect(UUIDUtilities.isUuid('A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D')).toBe(true);
        });

        it('rejects anything a uuid column could not be holding', () => {
            expect(UUIDUtilities.isUuid('not-a-uuid')).toBe(false);
            expect(UUIDUtilities.isUuid('')).toBe(false);
            // right shape, wrong alphabet
            expect(UUIDUtilities.isUuid('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).toBe(false);
            // the hyphens are part of the shape
            expect(UUIDUtilities.isUuid('a1b2c3d4e5f64a7b8c9d0e1f2a3b4c5d')).toBe(false);
            // one group too short, and one character too long
            expect(UUIDUtilities.isUuid('a1b2c3d4-e5f6-4a7b-8c9d')).toBe(false);
            expect(UUIDUtilities.isUuid('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5dd')).toBe(false);
        });

        it('rejects a uuid with anything around it', () => {
            // the sql injection shape: a real id with a payload glued on
            expect(UUIDUtilities.isUuid('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d\' OR \'1\'=\'1')).toBe(false);
            expect(UUIDUtilities.isUuid('\na1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d\n')).toBe(false);
        });
    });
});