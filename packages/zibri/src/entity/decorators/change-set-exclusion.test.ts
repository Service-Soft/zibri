import assert from 'node:assert';

import { describe, expect, it } from '@jest/globals';

import { Property, PropertyMetadata } from './property.decorator';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { type OneOf } from '../models/one-of.model';

/**
 * What a change set is allowed to hold.
 *
 * A change set records what changed so it can be read back and reset. That makes every value in it
 * a second copy, in a second table, of whatever the column holds - which is fine for a title and is
 * not fine for a secret. It also cannot be reset: `resetSingleChangeSet` writes stored values back
 * through the save hook that encrypts and hashes, so a stored ciphertext would be encrypted again
 * and a stored hash hashed again.
 */

class Secrets {
    @Property.string()
    title!: string;

    @Property.string({ encryption: { bindToRow: false } })
    apiKey!: string;

    @Property.string({ hash: true })
    password!: string;

    @Property.string({ encryption: { bindToRow: false }, excludeFromChangeSets: false })
    deliberatelyRecorded!: string;

    @Property.array({ items: { type: 'string', encryption: true } })
    recoveryCodes!: string[];

    @Property.array({ items: { type: 'array', items: { type: 'string', hash: true } } })
    pinsPerDevice!: string[][];

    @Property.oneOf({ shapes: { Email: { type: 'string', encryption: true }, Count: { type: 'number' } } })
    contact!: OneOf<{ Email: string, Count: number }>;

    @Property.array({ items: { type: 'string' } })
    tags!: string[];
}

/**
 * The declared metadata of one property.
 * @param key - The property to read.
 * @returns Its metadata.
 */
function metadataOf(key: keyof Secrets): PropertyMetadata {
    const metadata: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(Secrets)[key];
    assert(metadata, `Secrets declares no property "${String(key)}"`);
    return metadata;
}

describe('a property that holds a secret', () => {

    it('stays out of change sets without being told to', () => {
        expect(metadataOf('apiKey').excludeFromChangeSets).toBe(true);
        expect(metadataOf('password').excludeFromChangeSets).toBe(true);
    });

    it('stays out of change sets when its items or one of its shapes hold the secret', () => {
        expect(metadataOf('recoveryCodes').excludeFromChangeSets).toBe(true);
        expect(metadataOf('pinsPerDevice').excludeFromChangeSets).toBe(true);
        expect(metadataOf('contact').excludeFromChangeSets).toBe(true);
    });

    it('leaves every other property where it was', () => {
        // the default for everything else is unchanged: a change set is the audit trail, and
        // narrowing it beyond what has to be narrowed would quietly lose history
        expect(metadataOf('title').excludeFromChangeSets).toBe(false);
        expect(metadataOf('tags').excludeFromChangeSets).toBe(false);
    });

    it('lets the declaration say otherwise', () => {
        // a default rather than a rule. The declaration is the last word, because whether a given
        // encrypted column is a secret or merely encrypted at rest is not something to decide here
        expect(metadataOf('deliberatelyRecorded').excludeFromChangeSets).toBe(false);
    });
});