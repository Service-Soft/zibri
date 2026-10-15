/* eslint-disable jsdoc/require-jsdoc */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { EncryptionKey, EncryptionKeyStatus } from '../../auth/encryption/encryption-key.model';
import { EncryptionServiceInterface } from '../../auth/encryption/encryption-service.interface';
import { AesGcmEncryptionStrategy } from '../../auth/encryption/strategies/aes-gcm.encryption-strategy';
import { HashServiceInterface } from '../../auth/hash/hash-service.interface';
import { HashString } from '../../auth/hash/hash.utilities';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { type OneOf } from '../../entity/models/one-of.model';
import { needsReEncryption } from '../../global/model-registry/needs-re-encryption.function';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about encryption and hashing declared on the items
 * of an array and on the shapes of a value of several shapes: each string is encrypted or hashed as a
 * property declaring the same would be, and read back the same way. A file per data source runs them
 * against a repository of its own.
 */

export class PostalAddress {
    @Property.string()
    street!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Vault extends BaseEntity {
    @Property.array({ items: { type: 'string', encryption: true } })
    codes!: string[];

    @Property.array({ items: { type: 'string', hash: true }, required: false })
    pins?: string[];

    @Property.array({ items: { type: 'string', encryption: { strategy: AesGcmEncryptionStrategy, bindToRow: false } }, required: false })
    shared?: string[];

    @Property.oneOf({
        shapes: { Email: { type: 'string', encryption: true }, Postal: { type: 'object', cls: () => PostalAddress } },
        required: false
    })
    contact?: OneOf<{ Email: string, Postal: PostalAddress }>;

    @Property.array({
        items: { type: 'oneOf', shapes: { Note: { type: 'string', encryption: true }, Count: { type: 'number' } } },
        required: false
    })
    history?: OneOf<{ Note: string, Count: number }>[];
}

/**
 * Whether a stored value is an envelope the default strategy wrote, rather than the value itself.
 * @param value - The value as stored.
 * @returns True when it is encrypted.
 */
function isEncrypted(value: unknown): boolean {
    return typeof value === 'string' && value.split('.')[0] === 'aes-256-gcm';
}

/**
 * Whether a stored envelope is bound to the row it was written to.
 * @param value - The envelope as stored.
 * @returns True when it is bound.
 */
function isBound(value: string): boolean {
    return value.split('.')[3] === 'b';
}

/**
 * The id of the key a stored envelope was written with.
 * @param value - The envelope as stored.
 * @returns The id of the key.
 */
function keyIdOf(value: string): string | undefined {
    return value.split('.')[2];
}

/**
 * Runs every case against the rows of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param repositoryOf - Reads the repository, once the data source is started.
 */
export function describeEncryptedItems(dataSourceName: string, repositoryOf: () => Repository<Vault>): void {
    describe(`encryption and hashing on items and shapes, on ${dataSourceName}`, () => {
        beforeEach(async () => {
            await repositoryOf().deleteAll({});
        });

        it('encrypts each string of an array, bound to its row, and reads it back', async () => {
            const created: Vault = await repositoryOf().create({ codes: ['alpha', 'beta'] });

            const stored: Vault = await repositoryOf().findById(created.id, { autoDecrypt: false });
            expect(stored.codes).toHaveLength(2);
            expect(stored.codes.every(isEncrypted)).toBe(true);
            expect(stored.codes.every(isBound)).toBe(true);
            expect((await repositoryOf().findById(created.id)).codes).toEqual(['alpha', 'beta']);
            expect(created.codes).toEqual(['alpha', 'beta']);
        });

        it('encrypts with the strategy and the binding an item declares', async () => {
            const created: Vault = await repositoryOf().create({ codes: [], shared: ['gamma'] });

            const stored: Vault = await repositoryOf().findById(created.id, { autoDecrypt: false });
            expect(stored.shared?.every(isEncrypted)).toBe(true);
            expect(stored.shared?.some(isBound)).toBe(false);
            expect((await repositoryOf().findById(created.id)).shared).toEqual(['gamma']);
        });

        it('hashes each string of an array', async () => {
            const hashing: HashServiceInterface = inject(ZIBRI_DI_TOKENS.HASH_SERVICE);
            const created: Vault = await repositoryOf().create({ codes: [], pins: ['1234', '5678'] });

            const pins: string[] = (await repositoryOf().findById(created.id)).pins ?? [];
            expect(pins.every(p => hashing.isHash(p))).toBe(true);
            expect(await hashing.equal('1234', pins[0] as HashString)).toBe(true);
            expect(await hashing.equal('5678', pins[1] as HashString)).toBe(true);
        });

        it('encrypts the value of a string shape, and leaves the other shapes as they are', async () => {
            const email: Vault = await repositoryOf().create({ codes: [], contact: { shape: 'Email', value: 'ada@example.com' } });
            const postal: Vault = await repositoryOf().create({ codes: [], contact: { shape: 'Postal', value: { street: 'Main St' } } });

            const storedEmail: Vault = await repositoryOf().findById(email.id, { autoDecrypt: false });
            expect(storedEmail.contact?.shape).toBe('Email');
            expect(isEncrypted(storedEmail.contact?.value)).toBe(true);
            expect((await repositoryOf().findById(email.id)).contact).toEqual({ shape: 'Email', value: 'ada@example.com' });
            expect((await repositoryOf().findById(postal.id, { autoDecrypt: false })).contact)
                .toEqual({ shape: 'Postal', value: { street: 'Main St' } });
        });

        it('encrypts a string shape of each item of an array', async () => {
            const created: Vault = await repositoryOf().create({
                codes: [],
                history: [{ shape: 'Note', value: 'called back' }, { shape: 'Count', value: 3 }]
            });

            const stored: Vault = await repositoryOf().findById(created.id, { autoDecrypt: false });
            expect(isEncrypted(stored.history?.[0]?.value)).toBe(true);
            expect(stored.history?.[1]).toEqual({ shape: 'Count', value: 3 });
            expect((await repositoryOf().findById(created.id)).history)
                .toEqual([{ shape: 'Note', value: 'called back' }, { shape: 'Count', value: 3 }]);
        });

        it('encrypts items written to many rows at once for the row each lands in', async () => {
            const first: Vault = await repositoryOf().create({ codes: ['one'] });
            const second: Vault = await repositoryOf().create({ codes: ['two'] });

            await repositoryOf().updateAll({}, { codes: ['same'] });

            const stored: Vault[] = await repositoryOf().findAll({ autoDecrypt: false });
            expect(stored.flatMap(v => v.codes).every(c => isEncrypted(c) && isBound(c))).toBe(true);
            expect((await repositoryOf().findById(first.id)).codes).toEqual(['same']);
            expect((await repositoryOf().findById(second.id)).codes).toEqual(['same']);
        });

        it('finds an item written with a retired key, and rewrites it under the current one', async () => {
            const encryption: EncryptionServiceInterface = inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE);
            const created: Vault = await repositoryOf().create({ codes: ['delta'] });
            const before: Vault = await repositoryOf().findById(created.id, { autoDecrypt: false });
            const retired: string | undefined = keyIdOf(before.codes[0] ?? '');
            expect(await needsReEncryption(before, Vault, encryption)).toBe(false);

            const current: EncryptionKey = await encryption.createKey(AesGcmEncryptionStrategy, { status: EncryptionKeyStatus.ACTIVE });
            await encryption.markKeyAsDefaultForStrategy(current.id, AesGcmEncryptionStrategy);
            await encryption.deprecateKey(retired ?? '');

            expect(await needsReEncryption(before, Vault, encryption)).toBe(true);
            await repositoryOf().updateById(created.id, await repositoryOf().findById(created.id));
            const after: Vault = await repositoryOf().findById(created.id, { autoDecrypt: false });
            expect(keyIdOf(after.codes[0] ?? '')).toBe(current.id);
            expect(await needsReEncryption(after, Vault, encryption)).toBe(false);
        });
    });
}