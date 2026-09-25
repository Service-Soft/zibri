import { describe, expect, it } from '@jest/globals';

import { defaultScryptCost, ScryptCost, ScryptHashStrategy } from './scrypt.hash-strategy';
import { HashString, HashUtilities } from '../hash.utilities';

/**
 * Cheap enough to run in a test, and below anything this would ship with - which is what makes it
 * useful for the upgrade cases below.
 */
const cheap: ScryptCost = { n: 1024, r: 8, p: 1 };

describe('ScryptHashStrategy', () => {
    const strategy: ScryptHashStrategy = new ScryptHashStrategy(cheap);

    it('has the expected name and version', () => {
        expect(strategy.name).toBe('scrypt');
        expect(strategy.version).toBe('v1');
        expect(strategy.deterministic).toBe(false);
    });

    it('ships the cost current guidance asks for', () => {
        // node's own default is n=2^14. The value here is what a deployment gets without tuning
        // anything, so it is worth a test rather than a comment.
        expect(defaultScryptCost).toEqual({ n: 131072, r: 8, p: 1 });
    });

    it('hashes a value and verifies it against the original and a wrong value', async () => {
        const hashed: HashString = await strategy.hash('my-secret', undefined);

        await expect(strategy.equal('my-secret', hashed)).resolves.toBe(true);
        await expect(strategy.equal('wrong-secret', hashed)).resolves.toBe(false);
    });

    it('produces different hashes for the same value due to random salting', async () => {
        const first: HashString = await strategy.hash('same-value', undefined);
        const second: HashString = await strategy.hash('same-value', undefined);
        expect(first).not.toBe(second);
    });

    it('records the cost it used in the hash', async () => {
        const hashed: HashString = await strategy.hash('my-secret', undefined);
        expect(HashUtilities.hashToContent(hashed).hashedValue.startsWith('n=1024,r=8,p=1:')).toBe(true);
    });

    it('verifies a hash made at a different cost than the current one', async () => {
        // the reason the cost is written into the value: raising it must not invalidate what is
        // already stored, or every account is locked out by a configuration change
        const cheaper: ScryptHashStrategy = new ScryptHashStrategy({ n: 256, r: 8, p: 1 });
        const old: HashString = await cheaper.hash('my-secret', undefined);

        await expect(strategy.equal('my-secret', old)).resolves.toBe(true);
        await expect(strategy.equal('wrong-secret', old)).resolves.toBe(false);
    });

    it('verifies a hash from before the cost was recorded at all', async () => {
        // `<salt>:<hash>` with no parameters, which is what every hash written by an older version
        // looks like. Those were made at node's defaults and still have to verify.
        const nodeDefaults: ScryptHashStrategy = new ScryptHashStrategy({ n: 16384, r: 8, p: 1 });
        const current: HashString = await nodeDefaults.hash('my-secret', undefined);
        const [salt, hash] = HashUtilities.hashToContent(current).hashedValue.split(':').slice(1);
        const legacy: HashString = HashUtilities.contentToHash({
            strategyName: 'scrypt',
            version: 'v1',
            hashedValue: `${salt}:${hash}`
        });

        await expect(strategy.equal('my-secret', legacy)).resolves.toBe(true);
    });

    describe('needsRehash', () => {
        it('is false for a hash made at the current cost', async () => {
            const hashed: HashString = await strategy.hash('my-secret', undefined);
            expect(strategy.needsRehash(hashed)).toBe(false);
        });

        it('is true for a hash made more cheaply', async () => {
            const cheaper: ScryptHashStrategy = new ScryptHashStrategy({ n: 256, r: 8, p: 1 });
            const old: HashString = await cheaper.hash('my-secret', undefined);
            expect(strategy.needsRehash(old)).toBe(true);
        });

        it('is true for a hash from before the cost was recorded', () => {
            const legacy: HashString = HashUtilities.contentToHash({
                strategyName: 'scrypt',
                version: 'v1',
                hashedValue: `${'ab'.repeat(16)}:${'cd'.repeat(32)}`
            });
            // no parameters means node's defaults, which is more than this strategy asks for here -
            // so with a cheap current cost it does not need one. Against the shipped cost it does.
            expect(new ScryptHashStrategy(defaultScryptCost).needsRehash(legacy)).toBe(true);
        });

        it('is false for a hash made more expensively than the current cost', async () => {
            const dearer: ScryptHashStrategy = new ScryptHashStrategy({ n: 16384, r: 8, p: 1 });
            const strong: HashString = await dearer.hash('my-secret', undefined);
            expect(strategy.needsRehash(strong)).toBe(false);
        });
    });

    describe('isHashedValue', () => {
        it('accepts what it produced', async () => {
            const hashed: HashString = await strategy.hash('my-secret', undefined);
            expect(strategy.isHashedValue(HashUtilities.hashToContent(hashed).hashedValue)).toBe(true);
        });

        it('accepts the format from before the cost was recorded', () => {
            expect(strategy.isHashedValue(`${'ab'.repeat(16)}:${'cd'.repeat(32)}`)).toBe(true);
        });

        it('rejects a plaintext that merely looks like an envelope', () => {
            // the reason this exists: without it, `scrypt.v1.anything` would be taken for a hash, and
            // a password shaped like that would be stored in the clear
            expect(strategy.isHashedValue('hunter2')).toBe(false);
            expect(strategy.isHashedValue('not-hex:also-not-hex')).toBe(false);
            expect(strategy.isHashedValue(`n=1024,r=8,p=1:zzzz:${'cd'.repeat(32)}`)).toBe(false);
        });
    });
});