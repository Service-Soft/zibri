import { describe, expect, it } from 'vitest';

import { Property, PropertyMetadata } from './property.decorator.ts';
import { AesGcmEncryptionStrategy } from '../../auth/encryption/strategies/aes-gcm.encryption-strategy.ts';
import { BaseEncryptOptions, EncryptionStrategyInterface } from '../../auth/encryption/strategies/encryption-strategy.interface.ts';
import { BcryptHashStrategy } from '../../auth/hash/strategies/bcrypt.hash-strategy.ts';
import { ScryptHashStrategy } from '../../auth/hash/strategies/scrypt.hash-strategy.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { MetadataInjectionKeys } from '../../utilities/metadata-injection-keys.enum.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { ReflectUtilities } from '../../utilities/reflect.utilities.ts';
import { BaseEntity } from '../base-entity.model.ts';
import { type OneOf } from '../models/one-of.model.ts';
import { RelationType } from '../models/relation-type.enum.ts';
import { type Relation } from '../models/relation.type.ts';

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

            // bcrypt is deprecated for new hashes, and is still the shipped strategy whose options differ
            // from scrypt's, which is what these declarations need
            /* eslint-disable typescript/no-deprecated */
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
            /* eslint-enable typescript/no-deprecated */

            // @ts-expect-error - "region" is an option of the other item shape's strategy, not of this one's
            @Property.array({ items: { type: 'oneOf', shapes: { Remote: { type: 'string', encryption: { strategy: RemoteStrategy } }, Local: { type: 'string', encryption: { strategy: AesGcmEncryptionStrategy, encrypt: { region: 'eu' } } } } } })
            swappedItems!: OneOf<{ Remote: string, Local: string }>[];
        }

        const secret: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(Vault)['secret'];
        expect(secret?.type === 'oneOf' && secret.shapes['Local']?.type === 'string' ? secret.shapes['Local'].encryption : undefined)
            .toEqual({ strategy: AesGcmEncryptionStrategy, encrypt: { aad: 'vault' } });
    });
});

describe('a to-one relation', () => {
    // declared in this order on purpose: the shelf names the plaque before the plaque's class exists, which
    // is where a property recording the related class would read it too early
    class Shelf extends BaseEntity {
        @Property.hasOne({ target: () => Plaque, inverseSide: 'shelf' })
        plaque?: Relation<Plaque>;

        @Property.manyToOne({ target: () => Plaque, joinColumn: 'favoriteId', inverseSide: 'shelf' })
        favorite!: Relation<Plaque>;

        @Property.string()
        favoriteId!: string;
    }

    class Plaque extends BaseEntity {
        @Property.belongsToOne({ target: () => Shelf, joinColumn: 'shelfId', inverseSide: 'plaque' })
        shelf!: Relation<Shelf>;

        @Property.string()
        shelfId!: string;
    }

    it('records no reference to the related class', () => {
        expect(ReflectUtilities.getMetadata(MetadataInjectionKeys.TYPE, Shelf, 'plaque')).toBe(Object);
        expect(ReflectUtilities.getMetadata(MetadataInjectionKeys.TYPE, Plaque, 'shelf')).toBe(Object);
        expect(MetadataUtilities.getModelProperties(Shelf)['plaque']?.type).toBe(RelationType.HAS_ONE);
    });

    it('holds the related entity like its own type does', () => {
        const plaque: Plaque = new Plaque();
        const shelf: Shelf = new Shelf();
        shelf.plaque = plaque;
        const read: Plaque | undefined = shelf.plaque;

        expect(read).toBe(plaque);
    });

    it('is declared as Relation<Entity>, while compiling', () => {
        class Bookend extends BaseEntity {
            // @ts-expect-error - a has one relation declared as the entity's own type
            @Property.hasOne({ target: () => Plaque, inverseSide: 'shelf' })
            plaque?: Plaque;

            // @ts-expect-error - a belongs to one relation declared as the entity's own type
            @Property.belongsToOne({ target: () => Shelf, joinColumn: 'shelfId', inverseSide: 'plaque' })
            shelf!: Shelf;

            @Property.string()
            shelfId!: string;

            // @ts-expect-error - a many to one relation declared as the entity's own type
            @Property.manyToOne({ target: () => Shelf, joinColumn: 'shelfId', inverseSide: 'plaque' })
            other!: Shelf;
        }

        expect(MetadataUtilities.getModelProperties(Bookend)['shelf']?.type).toBe(RelationType.BELONGS_TO_ONE);
    });

    it('leaves a to-many relation declared as a list of the entity', () => {
        class Rack extends BaseEntity {
            @Property.oneToMany({ target: () => Rack, inverseSide: 'racks' })
            racks!: Rack[];
        }

        expect(MetadataUtilities.getModelProperties(Rack)['racks']?.type).toBe(RelationType.ONE_TO_MANY);
    });
});