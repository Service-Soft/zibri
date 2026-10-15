import { describe, expect, it } from '@jest/globals';

import { Property, PropertyMetadata } from './property.decorator';
import { AesGcmEncryptionStrategy } from '../../auth/encryption/strategies/aes-gcm.encryption-strategy';
import { BaseEncryptOptions, EncryptionStrategyInterface } from '../../auth/encryption/strategies/encryption-strategy.interface';
import { BcryptHashStrategy } from '../../auth/hash/strategies/bcrypt.hash-strategy';
import { ScryptHashStrategy } from '../../auth/hash/strategies/scrypt.hash-strategy';
import { InternalError } from '../../error-handling/internal-error.model';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { type OneOf } from '../models/one-of.model';

/**
 * Encryption and hashing declared on a string, wherever the string sits: a property, an item of an
 * array, a shape of a value of several shapes.
 */

/**
 * Options of a strategy that keeps its keys elsewhere, named by region.
 */
type RemoteEncryptOptions = BaseEncryptOptions<string> & {
    /**
     * Where the key lives.
     */
    region: string
};

/**
 * A strategy whose keys are handles rather than material, so its key type is not the default one.
 */
class RemoteStrategy implements EncryptionStrategyInterface<string, RemoteEncryptOptions> {
    readonly name: string = 'remote';
    readonly version: string = 'v1';
    readonly usableInMigrations: boolean = false;
    readonly encrypt: EncryptionStrategyInterface<string, RemoteEncryptOptions>['encrypt'] = value => {
        throw new InternalError(`Not encrypting ${value.length} characters here.`);
    };
    readonly decrypt: EncryptionStrategyInterface<string, RemoteEncryptOptions>['decrypt'] = value => {
        throw new InternalError(`Not decrypting ${value.length} characters here.`);
    };
    readonly isBoundToRow: EncryptionStrategyInterface<string, RemoteEncryptOptions>['isBoundToRow'] = () => true;
    readonly generateRandomKey: () => string = () => 'handle';
    readonly serializeKey: (key: string) => Buffer = key => Buffer.from(key);
    readonly deserializeKey: (raw: Buffer) => string = raw => raw.toString();
}

describe('encryption and hashing on a string', () => {
    it('refuses both at once on a property, an item and a shape', () => {
        expect(() => {
            class Account {
                @Property.string({ encryption: true, hash: true })
                secret!: string;
            }
            return Account;
        }).toThrow('Cannot set the flags "encryption" and "hash" at the same time.');

        expect(() => {
            class Account {
                @Property.array({ items: { type: 'string', encryption: true, hash: true } })
                secrets!: string[];
            }
            return Account;
        }).toThrow('Cannot set the flags "encryption" and "hash" at the same time.');

        expect(() => {
            class Account {
                @Property.oneOf({ shapes: { Secret: { type: 'string', encryption: true, hash: true }, Count: { type: 'number' } } })
                secret!: OneOf<{ Secret: string, Count: number }>;
            }
            return Account;
        }).toThrow('Cannot set the flags "encryption" and "hash" at the same time.');
    });

    it('checks the options of an item or a shape against the strategy it names, while compiling', () => {
        class Vault {
            @Property.array({ items: { type: 'string', encryption: { strategy: RemoteStrategy, encrypt: { region: 'eu' } } } })
            codes!: string[];

            @Property.oneOf({
                shapes: { Email: { type: 'string', encryption: { strategy: RemoteStrategy, encrypt: { region: 'eu' } } }, Count: { type: 'number' } }
            })
            contact!: OneOf<{ Email: string, Count: number }>;

            // @ts-expect-error - "zone" is no option of the strategy the item names
            @Property.array({ items: { type: 'string', encryption: { strategy: RemoteStrategy, encrypt: { zone: 'eu' } } } })
            unknownOption!: string[];

            // @ts-expect-error - the region is text, and the item gives a number
            @Property.array({ items: { type: 'string', encryption: { strategy: RemoteStrategy, encrypt: { region: 1 } } } })
            mistyped!: string[];

            // @ts-expect-error - "zone" is no option of the strategy the shape names
            @Property.oneOf({ shapes: { Email: { type: 'string', encryption: { strategy: RemoteStrategy, encrypt: { zone: 'eu' } } }, No: { type: 'number' } } })
            unknownShapeOption!: OneOf<{ Email: string, No: number }>;

            // @ts-expect-error - nor beside one that is
            @Property.oneOf({ shapes: { Email: { type: 'string', encryption: { strategy: RemoteStrategy, encrypt: { region: 'eu', zone: 'eu' } } }, No: { type: 'number' } } })
            besideKnownShapeOption!: OneOf<{ Email: string, No: number }>;

            // @ts-expect-error - nor on the items of a shape that is a list
            @Property.oneOf({ shapes: { Emails: { type: 'array', items: { type: 'string', encryption: { strategy: RemoteStrategy, encrypt: { region: 'eu', zone: 'eu' } } } }, No: { type: 'number' } } })
            besideKnownItemShapeOption!: OneOf<{ Emails: string[], No: number }>;
        }

        const codes: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(Vault)['codes'];
        expect(codes?.type === 'array' && codes.items.type === 'string' ? codes.items.encryption : undefined)
            .toEqual({ strategy: RemoteStrategy, encrypt: { region: 'eu' } });
    });

    it('takes a different strategy on each shape, each checked against its own options, while compiling', () => {
        class Vault {
            @Property.oneOf({
                shapes: {
                    Remote: { type: 'string', encryption: { strategy: RemoteStrategy, encrypt: { region: 'eu' } } },
                    Local: { type: 'string', encryption: { strategy: AesGcmEncryptionStrategy, encrypt: { aad: 'vault' } } }
                }
            })
            secret!: OneOf<{ Remote: string, Local: string }>;

            @Property.oneOf({
                shapes: {
                    Slow: { type: 'string', hash: { strategy: BcryptHashStrategy, strategyOptions: { rounds: 12 } } },
                    Fast: { type: 'string', hash: { strategy: ScryptHashStrategy, strategyOptions: { saltLength: 32 } } }
                }
            })
            pin!: OneOf<{ Slow: string, Fast: string }>;

            @Property.array({
                items: {
                    type: 'oneOf',
                    shapes: {
                        Remote: { type: 'string', encryption: { strategy: RemoteStrategy, encrypt: { region: 'eu' } } },
                        Local: { type: 'string', encryption: { strategy: AesGcmEncryptionStrategy, encrypt: { aad: 'vault' } } }
                    }
                }
            })
            history!: OneOf<{ Remote: string, Local: string }>[];

            // @ts-expect-error - "aad" is an option of the other shape's strategy, not of this one's
            @Property.oneOf({ shapes: { Remote: { type: 'string', encryption: { strategy: RemoteStrategy, encrypt: { aad: 'vault' } } }, Local: { type: 'string', encryption: { strategy: AesGcmEncryptionStrategy } } } })
            swapped!: OneOf<{ Remote: string, Local: string }>;

            // @ts-expect-error - "rounds" is an option of the other shape's strategy, not of this one's
            @Property.oneOf({ shapes: { Slow: { type: 'string', hash: { strategy: BcryptHashStrategy } }, Fast: { type: 'string', hash: { strategy: ScryptHashStrategy, strategyOptions: { rounds: 12 } } } } })
            swappedHash!: OneOf<{ Slow: string, Fast: string }>;

            // @ts-expect-error - "region" is an option of the other item shape's strategy, not of this one's
            @Property.array({ items: { type: 'oneOf', shapes: { Remote: { type: 'string', encryption: { strategy: RemoteStrategy } }, Local: { type: 'string', encryption: { strategy: AesGcmEncryptionStrategy, encrypt: { region: 'eu' } } } } } })
            swappedItems!: OneOf<{ Remote: string, Local: string }>[];
        }

        const secret: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(Vault)['secret'];
        expect(secret?.type === 'oneOf' && secret.shapes['Local']?.type === 'string' ? secret.shapes['Local'].encryption : undefined)
            .toEqual({ strategy: AesGcmEncryptionStrategy, encrypt: { aad: 'vault' } });
    });
});