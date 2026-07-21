import { describe, expect, it } from '@jest/globals';

import { UUIDUtilities } from './uuid.utilities';

const UUID_V4_REGEX: RegExp = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

describe('UUIDUtilities', () => {
    it('generates a valid v4 uuid', () => {
        expect(UUIDUtilities.generate()).toMatch(UUID_V4_REGEX);
    });

    it('generates a different uuid on each call', () => {
        expect(UUIDUtilities.generate()).not.toBe(UUIDUtilities.generate());
    });
});