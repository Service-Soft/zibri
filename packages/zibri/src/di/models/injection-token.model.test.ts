import { describe, expect, it } from 'vitest';

import { InjectionToken } from './injection-token.model.ts';

describe('InjectionToken', () => {
    it('constructs successfully with a unique key', () => {
        expect(() => new InjectionToken<string>('test-token-unique-1')).not.toThrow();
    });

    it('throws when constructed with a key that is already in use', () => {

        new InjectionToken<string>('test-token-duplicate');
        expect(() => new InjectionToken<string>('test-token-duplicate')).toThrow(/already exists/);
    });

    it('toString returns the key', () => {
        // cspell:disable-next-line
        const token: InjectionToken<string> = new InjectionToken<string>('test-token-tostring');
        // cspell:disable-next-line
        expect(token.toString()).toBe('test-token-tostring');
        // oxlint-disable-next-line typescript/restrict-template-expressions cspell:disable-next-line
        expect(`${token}`).toBe('test-token-tostring');
    });
});