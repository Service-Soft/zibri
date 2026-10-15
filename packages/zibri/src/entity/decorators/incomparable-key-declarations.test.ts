import { describe, expect, it } from '@jest/globals';

import { Entity } from './entity.decorator';
import { Property } from './property.decorator';
import { ScryptHashStrategy } from '../../auth/hash/strategies/scrypt.hash-strategy';
import { InternalError } from '../../error-handling/internal-error.model';
import { BaseEntity } from '../base-entity.model';

/**
 * Which values a unique declaration can be about, as far as that is known where the entity is declared.
 *
 * A unique declaration compares what is stored, so it only means something for a value stored the
 * same way every time. An encrypted value never is across key rotation, whatever the strategy - a
 * value encrypted under the old key and the same value under the new one are two stored values - so
 * encryption is refused outright. Whether a hash strategy is deterministic is known once it is built,
 * so the hash service decides that at startup - except for a hash decided per row, which no strategy
 * can answer for and is refused here.
 */

describe('a unique declaration on an encrypted property', () => {
    it('refuses one on the property', () => {
        const declare: () => unknown = () => {
            @Entity({ tenant: 'shared', allowOrphan: true })
            class Vault extends BaseEntity {
                @Property.string({ unique: true, encryption: true })
                code!: string;
            }
            return Vault;
        };

        expect(declare).toThrow(InternalError);
        expect(declare).toThrow('Vault.code');
        expect(declare).toThrow('encrypted');
    });

    it('refuses a unique group naming one', () => {
        const declare: () => unknown = () => {
            @Entity({ tenant: 'shared', allowOrphan: true, uniques: [['tenantId', 'code']] })
            class TenantVault extends BaseEntity {
                @Property.string()
                tenantId!: string;

                @Property.string({ encryption: { bindToRow: false } })
                code!: string;
            }
            return TenantVault;
        };

        expect(declare).toThrow('TenantVault.code');
    });

    it('leaves a property that turns encryption off alone', () => {
        expect(() => {
            @Entity({ tenant: 'shared', allowOrphan: true })
            class PlainVault extends BaseEntity {
                @Property.string({ unique: true, encryption: false })
                code!: string;
            }
            return PlainVault;
        }).not.toThrow();
    });
});

describe('a unique declaration on a hashed property', () => {
    it('refuses one whose hashing is decided per row', () => {
        const declare: () => unknown = () => {
            @Entity({ tenant: 'shared', allowOrphan: true })
            class PerRowLogin extends BaseEntity {
                @Property.string({ unique: true, hash: () => ({ strategy: ScryptHashStrategy }) })
                secret!: string;
            }
            return PerRowLogin;
        };

        expect(declare).toThrow(InternalError);
        expect(declare).toThrow('PerRowLogin.secret');
        expect(declare).toThrow('decided per row');
    });

    it('refuses a unique group naming one whose hashing is decided per row', () => {
        const declare: () => unknown = () => {
            @Entity({ tenant: 'shared', allowOrphan: true, uniques: [['tenantId', 'secret']] })
            class TenantLogin extends BaseEntity {
                @Property.string()
                tenantId!: string;

                @Property.string({ hash: () => ({ strategy: ScryptHashStrategy }) })
                secret!: string;
            }
            return TenantLogin;
        };

        expect(declare).toThrow('TenantLogin.secret');
    });

    it('leaves a hash with a known strategy to be decided at startup', () => {
        expect(() => {
            @Entity({ tenant: 'shared', allowOrphan: true })
            class NamedLogin extends BaseEntity {
                @Property.string({ unique: true, hash: { strategy: ScryptHashStrategy } })
                secret!: string;

                @Property.string({ unique: true, hash: true })
                other!: string;
            }
            return NamedLogin;
        }).not.toThrow();
    });
});