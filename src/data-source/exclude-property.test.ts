import { describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../entity/base-entity.model';
import { Property } from '../entity/decorators/property.decorator';
import { removeExcludeProperties } from '../global/model-registry/remove-exclude-properties.function';
import { restoreExcludeProperties } from '../global/model-registry/restore-exclude-properties.function';
import { JsonUtilities } from '../utilities/json.utilities';

// ─── Test entities ────────────────────────────────────────────────────────────

class Address {
    @Property.string()
    street!: string;

    @Property.string({ exclude: true })
    internalCode!: string;
}

class Order {
    @Property.string({ primary: true })
    id!: string;

    @Property.number()
    total!: number;

    @Property.string({ exclude: true })
    internalNote!: string;

    @Property.manyToOne({ target: () => User, joinColumn: 'userId', inverseSide: 'orders' })
    user!: unknown;

    @Property.string({ format: 'uuid' })
    userId!: string;
}

class User extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.string({ exclude: true })
    passwordHash!: string;

    @Property.string({ exclude: true })
    secret!: string;

    @Property.object({ cls: () => Address })
    address!: Address;

    @Property.oneToMany({ target: () => Order, inverseSide: 'user' })
    orders!: Order[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeUser(overrides: Partial<User> = {}): User {
    const user: User = new User();
    user.id = 'user-1';
    user.name = 'Alice';
    user.passwordHash = 'hashed-pw';
    user.secret = 'top-secret';
    const address: Address = new Address();
    address.street = '123 Main St';
    address.internalCode = 'INT-001';
    user.address = address;
    const order: Order = new Order();
    order.id = 'order-1';
    order.total = 99;
    order.internalNote = 'do not ship';
    user.orders = [order];
    return Object.assign(user, overrides);
}

// ─── removeExcludeProperties ──────────────────────────────────────────────────

describe('removeExcludeProperties', () => {
    describe('basic exclusion', () => {
        it('makes excluded properties non-enumerable', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(user, 'passwordHash');
            expect(descriptor?.enumerable).toBe(false);
        });

        it('still allows reading excluded properties via getter', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            expect(user.passwordHash).toBe('hashed-pw');
            expect(user.secret).toBe('top-secret');
        });

        it('does not affect non-excluded properties', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(user, 'name');
            expect(descriptor?.enumerable).toBe(true);
            expect(user.name).toBe('Alice');
        });

        it('excluded properties do not appear in Object.keys', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            expect(Object.keys(user)).not.toContain('passwordHash');
            expect(Object.keys(user)).not.toContain('secret');
            expect(Object.keys(user)).toContain('name');
            expect(Object.keys(user)).toContain('id');
        });
    });

    describe('JsonUtilities serialization', () => {
        it('excluded properties are absent from JsonUtilities.stringify output', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            const json: unknown = JsonUtilities.parse(JsonUtilities.stringify(user));
            expect(json).not.toHaveProperty('passwordHash');
            expect(json).not.toHaveProperty('secret');
        });

        it('non-excluded properties are present in JsonUtilities.stringify output', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            const json: unknown = JsonUtilities.parse(JsonUtilities.stringify(user));
            expect(json).toHaveProperty('name', 'Alice');
            expect(json).toHaveProperty('id', 'user-1');
        });
    });

    describe('spreading', () => {
        it('excluded properties are absent after spreading the entity', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            const spread: User = { ...user };
            expect(spread).not.toHaveProperty('passwordHash');
            expect(spread).not.toHaveProperty('secret');
        });

        it('non-excluded properties are present after spreading', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            const spread: User = { ...user };
            expect(spread).toHaveProperty('name', 'Alice');
        });

        it('explicitly copying an excluded property after spread preserves it', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            const spread: User = { ...user, passwordHash: user.passwordHash };
            expect(spread).toHaveProperty('passwordHash', 'hashed-pw');
        });
    });

    describe('setter after hiding', () => {
        it('updating an excluded property via setter is reflected in the getter', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            user.passwordHash = 'new-hash';
            expect(user.passwordHash).toBe('new-hash');
        });

        it('updated value via setter is still not enumerable', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            user.passwordHash = 'new-hash';
            expect(Object.keys(user)).not.toContain('passwordHash');
        });
    });

    describe('idempotency', () => {
        it('calling removeExcludeProperties twice does not throw', () => {
            const user: User = makeUser();
            expect(async () => {
                await removeExcludeProperties(user, User);
                await removeExcludeProperties(user, User);
            }).not.toThrow();
        });

        it('value is unchanged after double application', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);
            await removeExcludeProperties(user, User);

            expect(user.passwordHash).toBe('hashed-pw');
        });
    });

    describe('nested object property', () => {
        it('excludes properties on nested objects', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            expect(Object.keys(user.address)).not.toContain('internalCode');
        });

        it('excluded nested property is still readable', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            expect(user.address.internalCode).toBe('INT-001');
        });

        it('nested excluded property absent from JSON output', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            const json: User = JsonUtilities.parse(JsonUtilities.stringify(user));
            expect(json.address).not.toHaveProperty('internalCode');
            expect(json.address).toHaveProperty('street', '123 Main St');
        });

        it('nested excluded property absent after spreading nested object', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            const spread: Address = { ...user.address };
            expect(spread).not.toHaveProperty('internalCode');
        });
    });

    describe('relation arrays (oneToMany)', () => {
        it('excludes properties on entities inside relation arrays', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            expect(Object.keys(user.orders[0])).not.toContain('internalNote');
        });

        it('excluded relation array item property is still readable', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            expect(user.orders[0].internalNote).toBe('do not ship');
        });

        it('relation array items excluded properties absent from JSON output', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            const json: User = JsonUtilities.parse(JsonUtilities.stringify(user));
            expect(json.orders[0]).not.toHaveProperty('internalNote');
            expect(json.orders[0]).toHaveProperty('total', 99);
        });

        it('spreading a relation array item loses excluded property', async () => {
            const user: User = makeUser();
            await removeExcludeProperties(user, User);

            const spread: Order = { ...user.orders[0] };
            expect(spread).not.toHaveProperty('internalNote');
        });
    });

    describe('null / undefined handling', () => {
        it('does not throw when called with null', async () => {
            // eslint-disable-next-line unicorn/no-null
            await expect(removeExcludeProperties(null, User)).resolves.not.toThrow();
        });

        it('does not throw when called with undefined', async () => {
            await expect(removeExcludeProperties(undefined, User)).resolves.not.toThrow();
        });

        it('does not throw when a nested relation is null', async () => {
            const user: User = makeUser();
            // eslint-disable-next-line unicorn/no-null
            user.address = null as unknown as Address;
            await expect(removeExcludeProperties(user, User)).resolves.not.toThrow();
        });
    });
});

// ─── restoreExcludeProperties ─────────────────────────────────────────────────

describe('restoreExcludeProperties', () => {
    it('restores excluded properties to enumerable own properties', async () => {
        const user: User = makeUser();
        await removeExcludeProperties(user, User);
        restoreExcludeProperties(user, User);

        const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(user, 'passwordHash');
        expect(descriptor?.enumerable).toBe(true);
        expect(descriptor?.get).toBeUndefined();
    });

    it('restored value is correct', async () => {
        const user: User = makeUser();
        await removeExcludeProperties(user, User);
        restoreExcludeProperties(user, User);

        expect(user.passwordHash).toBe('hashed-pw');
    });

    it('restored properties appear in Object.keys', async () => {
        const user: User = makeUser();
        await removeExcludeProperties(user, User);
        restoreExcludeProperties(user, User);

        expect(Object.keys(user)).toContain('passwordHash');
        expect(Object.keys(user)).toContain('secret');
    });

    it('restored properties appear in JsonUtilities.stringify output', async () => {
        const user: User = makeUser();
        await removeExcludeProperties(user, User);
        restoreExcludeProperties(user, User);

        const json: User = JsonUtilities.parse(JsonUtilities.stringify(user));
        expect(json).toHaveProperty('passwordHash', 'hashed-pw');
    });

    it('restores updated value, not original', async () => {
        const user: User = makeUser();
        await removeExcludeProperties(user, User);
        user.passwordHash = 'updated-hash';
        restoreExcludeProperties(user, User);

        expect(user.passwordHash).toBe('updated-hash');
        expect(Object.getOwnPropertyDescriptor(user, 'passwordHash')?.enumerable).toBe(true);
    });

    it('is safe to call on data that was never hidden (plain create data)', () => {
        const plainData: Partial<User> = { name: 'Bob', passwordHash: 'raw-hash' };
        expect(() => restoreExcludeProperties(plainData, User)).not.toThrow();
        expect(plainData.name).toBe('Bob');
    });

    it('restores nested object excluded properties', async () => {
        const user: User = makeUser();
        await removeExcludeProperties(user, User);
        restoreExcludeProperties(user, User);

        const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(user.address, 'internalCode');
        expect(descriptor?.enumerable).toBe(true);
        expect(user.address.internalCode).toBe('INT-001');
    });

    it('restores relation array item excluded properties', async () => {
        const user: User = makeUser();
        await removeExcludeProperties(user, User);
        restoreExcludeProperties(user, User);

        const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(user.orders[0], 'internalNote');
        expect(descriptor?.enumerable).toBe(true);
        expect(user.orders[0].internalNote).toBe('do not ship');
    });

    describe('round-trip', () => {
        it('remove then restore produces an object equal to the original', async () => {
            const user: User = makeUser();
            const original: User = JsonUtilities.parse(JsonUtilities.stringify({
                ...user,
                passwordHash: user.passwordHash,
                secret: user.secret,
                address: { ...user.address, internalCode: user.address.internalCode },
                orders: user.orders.map(o => ({ ...o, internalNote: o.internalNote }))
            }));

            await removeExcludeProperties(user, User);
            restoreExcludeProperties(user, User);

            expect(JsonUtilities.parse(JsonUtilities.stringify(user))).toEqual(original);
        });
    });
});

// ─── Decorator guard ──────────────────────────────────────────────────────────

describe('Property decorator', () => {
    it('throws when a primary key is marked as excluded', () => {
        expect(() => {
            // eslint-disable-next-line unusedImports/no-unused-vars
            class BadEntity {
                @Property.string({ primary: true, exclude: true })
                id!: string;
            }
        }).toThrow('BadEntity.id: Cannot mark a primary key with "exclude."');
    });
});