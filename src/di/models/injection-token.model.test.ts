import { describe, expect, it } from '@jest/globals';

import { InjectionToken } from './injection-token.model';

describe('InjectionToken', () => {
    it('constructs successfully with a unique key', () => {
        expect(() => new InjectionToken<string>('test-token-unique-1')).not.toThrow();
    });

    it('throws when constructed with a key that is already in use', () => {

        new InjectionToken<string>('test-token-duplicate');
        expect(() => new InjectionToken<string>('test-token-duplicate')).toThrow(/already exists/);
    });

    it('toString returns the key', () => {
        // eslint-disable-next-line cspell/spellchecker
        const token: InjectionToken<string> = new InjectionToken<string>('test-token-tostring');
        // eslint-disable-next-line cspell/spellchecker
        expect(token.toString()).toBe('test-token-tostring');
        // eslint-disable-next-line cspell/spellchecker
        expect(`${token}`).toBe('test-token-tostring');
    });
});