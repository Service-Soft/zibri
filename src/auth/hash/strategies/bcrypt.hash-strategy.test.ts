import { describe, expect, it } from '@jest/globals';

import { BcryptHashStrategy } from './bcrypt.hash-strategy';
import { HashString } from '../hash.utilities';

describe('BcryptHashStrategy', () => {
    const strategy: BcryptHashStrategy = new BcryptHashStrategy();

    it('has the expected name and version', () => {
        expect(strategy.name).toBe('bcrypt');
        expect(strategy.version).toBe('v1');
    });

    it('hashes a value and verifies it against the original and a wrong value', async () => {
        const hashed: HashString = await strategy.hash('my-secret', undefined);
        expect(hashed).toBeTruthy();

        await expect(strategy.equal('my-secret', hashed)).resolves.toBe(true);
        await expect(strategy.equal('wrong-secret', hashed)).resolves.toBe(false);
    });

    it('respects a custom rounds option', async () => {
        const hashed: HashString = await strategy.hash('my-secret', { rounds: 4 });
        await expect(strategy.equal('my-secret', hashed)).resolves.toBe(true);
    });

    it('produces different hashes for the same value due to random salting', async () => {
        const first: HashString = await strategy.hash('same-value', undefined);
        const second: HashString = await strategy.hash('same-value', undefined);
        expect(first).not.toBe(second);
    });
});