import { describe, expect, it } from '@jest/globals';

import { Property, PropertyMetadata } from './property.decorator';
import { AesGcmEncryptionStrategy } from '../../auth/encryption/strategies/aes-gcm.encryption-strategy';
import { BaseEncryptOptions, EncryptionStrategyInterface } from '../../auth/encryption/strategies/encryption-strategy.interface';
import { BcryptHashStrategy } from '../../auth/hash/strategies/bcrypt.hash-strategy';
import { ScryptHashStrategy } from '../../auth/hash/strategies/scrypt.hash-strategy';
import { InternalError } from '../../error-handling/internal-error.model';
import { File } from '../../parsing/form-data/file.model';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { BaseEntity } from '../base-entity.model';
import { type OneOf } from '../models/one-of.model';
import { Relation } from '../models/relation.enum';

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
                @Property.string({ encryption: true, hash: true, password: false })
                secret!: string;
            }
            return Account;
        }).toThrow('Cannot set the flags "encryption" and "hash" at the same time.');

        expect(() => {
            class Account {
                @Property.array({ items: { type: 'string', encryption: true, hash: true, password: false } })
                secrets!: string[];
            }
            return Account;
        }).toThrow('Cannot set the flags "encryption" and "hash" at the same time.');

        expect(() => {
            class Account {
                @Property.oneOf({ shapes: { Secret: { type: 'string', encryption: true, hash: true, password: false }, Count: { type: 'number' } } })
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
                    Slow: { type: 'string', hash: { strategy: BcryptHashStrategy, strategyOptions: { rounds: 12 } }, password: false },
                    Fast: { type: 'string', hash: { strategy: ScryptHashStrategy, strategyOptions: { saltLength: 32 } }, password: false }
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
            @Property.oneOf({ shapes: { Slow: { type: 'string', hash: { strategy: BcryptHashStrategy }, password: false }, Fast: { type: 'string', hash: { strategy: ScryptHashStrategy, strategyOptions: { rounds: 12 } }, password: false } } })
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

// a hashed string was a password or a token by nothing but the strategy it named, so no password was
// ever checked against a policy, and nothing told a forgotten password from a token
describe('a password', () => {
    it('is hashed without saying so, and kept out of change sets', () => {
        class Account {
            @Property.string({ password: true })
            password!: string;
        }

        const password: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(Account)['password'];
        expect(password?.type === 'string' ? [password.password, password.hash, password.excludeFromChangeSets] : undefined)
            .toEqual([true, true, true]);
    });

    it('refuses a hashed string that does not say whether it is a password, on a property, an item and a shape', () => {
        expect(() => {
            class Account {
                @Property.string({ hash: true })
                secret!: string;
            }
            return Account;
        }).toThrow(/Account\.secret: A hashed string says whether it is a password/);

        expect(() => {
            class Account {
                @Property.array({ items: { type: 'string', hash: true } })
                secrets!: string[];
            }
            return Account;
        }).toThrow(/Account\.secrets: A hashed string says whether it is a password/);

        expect(() => {
            class Account {
                @Property.oneOf({ shapes: { Secret: { type: 'string', hash: true }, Count: { type: 'number' } } })
                secret!: OneOf<{ Secret: string, Count: number }>;
            }
            return Account;
        }).toThrow(/Account\.secret\.Secret: A hashed string says whether it is a password/);

        class Token {
            @Property.string({ hash: true, password: false })
            value!: string;
        }
        const value: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(Token)['value'];
        expect(value?.type === 'string' ? [value.password, value.hash] : undefined).toEqual([false, true]);
    });

    it('refuses a password that is not hashed, or not hashed the same way for every row', () => {
        expect(() => {
            class Account {
                @Property.string({ password: true, hash: false })
                password!: string;
            }
            return Account;
        }).toThrow(/Account\.password: A password is hashed/);

        expect(() => {
            class Account {
                @Property.string({ password: true, hash: () => ({ strategy: ScryptHashStrategy }) })
                password!: string;
            }
            return Account;
        }).toThrow(/Account\.password: How a password is hashed is decided per row/);
    });

    it('refuses a password as an item or a shape', () => {
        expect(() => {
            class Account {
                @Property.array({ items: { type: 'string', password: true } })
                passwords!: string[];
            }
            return Account;
        }).toThrow(/Account\.passwords: A password is a property of its own/);

        expect(() => {
            class Account {
                @Property.oneOf({ shapes: { Password: { type: 'string', password: true }, Count: { type: 'number' } } })
                secret!: OneOf<{ Password: string, Count: number }>;
            }
            return Account;
        }).toThrow(/Account\.secret\.Password: A password is a property of its own/);
    });

    it('refuses what the password policy says, or what a salted hash cannot hold', () => {
        for (const declared of [
            { minLength: 15 },
            { maxLength: 64 },
            { regex: /\d/ },
            { format: 'email' as const },
            { default: 'welcome' },
            { unique: true },
            { index: true }
        ]) {
            expect(() => {
                class Account {
                    @Property.string({ password: true, ...declared })
                    password!: string;
                }
                return Account;
            }).toThrow(`Account.password: A password cannot declare "${Object.keys(declared)[0]}"`);
        }
    });
});

// every store refuses a to one relation without the column of its foreign key, and
// the type let one through
describe('a to one relation', () => {
    it('names the property of its class that holds the foreign key, while compiling', () => {
        class Team extends BaseEntity {
            @Property.oneToMany({ target: () => Seat, inverseSide: 'team' })
            seats!: Seat[];
        }

        class Seat extends BaseEntity {
            @Property.manyToOne({ target: () => Team, joinColumn: 'teamId', inverseSide: 'seats' })
            team!: Team;

            @Property.string({ format: 'uuid' })
            teamId!: string;

            @Property.belongsToOne({ target: () => Team, joinColumn: 'homeTeamId', inverseSide: 'seats' })
            homeTeam!: Team;

            @Property.string({ format: 'uuid' })
            homeTeamId!: string;

            // @ts-expect-error - a many to one relation names the column of its foreign key
            @Property.manyToOne({ target: () => Team, inverseSide: 'seats' })
            withoutColumn!: Team;

            // @ts-expect-error - "teamUuid" is no property of the class
            @Property.manyToOne({ target: () => Team, joinColumn: 'teamUuid', inverseSide: 'seats' })
            misnamed!: Team;

            // @ts-expect-error - a belongs to one relation names the column of its foreign key
            @Property.belongsToOne({ target: () => Team, inverseSide: 'seats' })
            belongingWithoutColumn!: Team;

            // @ts-expect-error - "homeTeamUuid" is no property of the class
            @Property.belongsToOne({ target: () => Team, joinColumn: 'homeTeamUuid', inverseSide: 'seats' })
            belongingMisnamed!: Team;
        }

        const team: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(Seat)['team'];
        expect(team?.type === Relation.MANY_TO_ONE ? team.joinColumn : undefined).toBe('teamId');
    });
});

describe('a file property', () => {
    // it warned and then took every file type, so a forgotten list read exactly like a decision to
    // accept anything
    it('names the types of file it takes, or says it takes all of them', () => {
        class Upload {
            // @ts-expect-error - a file property names its mime types, or 'all'
            @Property.file({ maxSize: '1mb' })
            attachment!: File;

            @Property.file({ allowedMimeTypes: 'all' })
            anything!: File;
        }

        expect(MetadataUtilities.getModelProperties(Upload)['anything']).toHaveProperty('allowedMimeTypes', 'all');
    });
});