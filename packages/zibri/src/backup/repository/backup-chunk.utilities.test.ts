import { CipherGCM, createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { BackupChunkUtilities } from './backup-chunk.utilities';
import { BackupRepositoryKey } from './backup-repository-key.model';

/**
 * A repository key of random bytes.
 * @returns The key.
 */
function resolveKey(): BackupRepositoryKey {
    return { id: 'key', idKey: randomBytes(32), dataKey: randomBytes(32) };
}

describe('BackupChunkUtilities', () => {
    const key: BackupRepositoryKey = resolveKey();
    const compressible: Buffer = Buffer.from('a row of a table, '.repeat(10_000));
    const incompressible: Buffer = randomBytes(64 * 1024);

    it('opens what it sealed, compressed or not, encrypted or not, of a few bytes as well', async () => {
        for (const data of [compressible, incompressible, Buffer.from('every task')]) {
            for (const k of [key, undefined]) {
                const id: string = await BackupChunkUtilities.resolveId(data, k);
                const stored: Buffer = await BackupChunkUtilities.seal(data, id, k, 3);

                expect((await BackupChunkUtilities.open(stored, id, k, data.length)).equals(data)).toBe(true);
                expect(stored.length).toBeLessThanOrEqual(data.length + BackupChunkUtilities.OVERHEAD_BYTES);
            }
        }
    });

    it('stores what compresses smaller than it is', async () => {
        const id: string = await BackupChunkUtilities.resolveId(compressible, key);

        expect((await BackupChunkUtilities.seal(compressible, id, key, 3)).length).toBeLessThan(compressible.length / 10);
    });

    it('names an encrypted chunk by its HMAC-SHA256 under the id key, and an unencrypted one by its sha256', async () => {
        const plain: string = createHash('sha256').update(incompressible)
            .digest('hex');

        expect(await BackupChunkUtilities.resolveId(incompressible, undefined)).toBe(plain);
        expect(await BackupChunkUtilities.resolveId(incompressible, key)).toBe(createHmac('sha256', key.idKey).update(incompressible)
            .digest('hex'));
        expect(await BackupChunkUtilities.resolveId(incompressible, resolveKey())).not.toBe(await BackupChunkUtilities.resolveId(incompressible, key));
    });

    it('opens a chunk sealed as AES-256-GCM of its header and id, with the tag after the ciphertext', async () => {
        const id: string = await BackupChunkUtilities.resolveId(incompressible, key);
        // what the stored shape is, written without the utilities: format 1, stored as it is, a nonce
        const header: Buffer = Buffer.from([1, 0]);
        const nonce: Buffer = randomBytes(12);
        const cipher: CipherGCM = createCipheriv('aes-256-gcm', key.dataKey, nonce, { authTagLength: 16 });
        cipher.setAAD(Buffer.concat([header, Buffer.from(id, 'hex')]));
        const stored: Buffer = Buffer.concat([header, nonce, cipher.update(incompressible), cipher.final(), cipher.getAuthTag()]);

        expect((await BackupChunkUtilities.open(stored, id, key, incompressible.length)).equals(incompressible)).toBe(true);
    });

    it('encrypts the same chunk to other bytes each time, both of which open', async () => {
        const id: string = await BackupChunkUtilities.resolveId(incompressible, key);
        const first: Buffer = await BackupChunkUtilities.seal(incompressible, id, key, 3);
        const second: Buffer = await BackupChunkUtilities.seal(incompressible, id, key, 3);

        expect(first.equals(second)).toBe(false);
        expect((await BackupChunkUtilities.open(second, id, key, incompressible.length)).equals(incompressible)).toBe(true);
    });

    it('refuses a chunk changed where it is stored, stored under another id, or opened with another key', async () => {
        for (const k of [key, undefined]) {
            const id: string = await BackupChunkUtilities.resolveId(compressible, k);
            const stored: Buffer = await BackupChunkUtilities.seal(compressible, id, k, 3);
            const changed: Buffer = Buffer.from(stored);
            changed[changed.length - 20] = (changed[changed.length - 20] ?? 0) ^ 1;
            const otherId: string = await BackupChunkUtilities.resolveId(incompressible, k);

            await expect(BackupChunkUtilities.open(changed, id, k, compressible.length)).rejects.toThrow(`The chunk ${id} is not the chunk it is stored as`);
            await expect(BackupChunkUtilities.open(stored, otherId, k, compressible.length)).rejects.toThrow('is not the chunk it is stored as');
            await expect(BackupChunkUtilities.open(stored.subarray(0, 10), id, k, compressible.length)).rejects.toThrow('is not the chunk it is stored as');
        }
        const id: string = await BackupChunkUtilities.resolveId(compressible, key);
        const stored: Buffer = await BackupChunkUtilities.seal(compressible, id, key, 3);
        await expect(BackupChunkUtilities.open(stored, id, resolveKey(), compressible.length)).rejects.toThrow('does not decrypt');
    });

    it('refuses a chunk whose data is not the length the manifest says', async () => {
        const id: string = await BackupChunkUtilities.resolveId(incompressible, key);
        const stored: Buffer = await BackupChunkUtilities.seal(incompressible, id, key, 3);

        await expect(BackupChunkUtilities.open(stored, id, key, incompressible.length - 1)).rejects.toThrow('is not the data of its id');
    });

    it('refuses a chunk in a shape this build does not read', async () => {
        const id: string = await BackupChunkUtilities.resolveId(incompressible, undefined);
        const stored: Buffer = await BackupChunkUtilities.seal(incompressible, id, undefined, 3);
        stored[0] = 9;

        await expect(BackupChunkUtilities.open(stored, id, undefined, incompressible.length)).rejects.toThrow('which this build does not read');
        await expect(BackupChunkUtilities.validateStored(stored, id, undefined, incompressible.length)).rejects.toThrow('which this build does not read');
    });

    // what a restore checks each chunk with as it is fetched, before anything is applied. An encrypted one was
    // decompressed and hashed there and again where it is applied, which made a restore of chunks a tenth slower
    // than one of a single file
    it('takes what it sealed as the chunk of its id, and refuses one changed, stored under another id or of another key', async () => {
        for (const data of [compressible, incompressible]) {
            for (const k of [key, undefined]) {
                const id: string = await BackupChunkUtilities.resolveId(data, k);
                const stored: Buffer = await BackupChunkUtilities.seal(data, id, k, 3);
                const changed: Buffer = Buffer.from(stored);
                changed[changed.length - 20] = (changed[changed.length - 20] ?? 0) ^ 1;
                const otherId: string = await BackupChunkUtilities.resolveId(Buffer.from('another chunk'), k);

                await expect(BackupChunkUtilities.validateStored(stored, id, k, data.length)).resolves.toBeUndefined();
                await expect(BackupChunkUtilities.validateStored(changed, id, k, data.length)).rejects.toThrow(`The chunk ${id} is not the chunk it is stored as`);
                await expect(BackupChunkUtilities.validateStored(stored, otherId, k, data.length)).rejects.toThrow('is not the chunk it is stored as');
                await expect(BackupChunkUtilities.validateStored(stored.subarray(0, 10), id, k, data.length)).rejects.toThrow('is not the chunk it is stored as');
            }
        }
        const id: string = await BackupChunkUtilities.resolveId(compressible, key);
        const stored: Buffer = await BackupChunkUtilities.seal(compressible, id, key, 3);
        await expect(BackupChunkUtilities.validateStored(stored, id, resolveKey(), compressible.length)).rejects.toThrow('does not decrypt');
    });

    // the tag of an encrypted chunk covers its stored bytes and its id, so only whoever holds the key seals one that
    // passes: whether its data hashes to the id is checked where it is opened, which has to decompress it anyway.
    // The id of an unencrypted chunk is all that holds it, so it is checked in full
    it('checks an encrypted chunk by its encryption alone, and an unencrypted one by its data', async () => {
        const otherId: string = await BackupChunkUtilities.resolveId(incompressible, key);
        const sealedUnderOther: Buffer = await BackupChunkUtilities.seal(compressible, otherId, key, 3);
        const plainOtherId: string = await BackupChunkUtilities.resolveId(incompressible, undefined);
        const plainUnderOther: Buffer = await BackupChunkUtilities.seal(compressible, plainOtherId, undefined, 3);

        await expect(BackupChunkUtilities.validateStored(sealedUnderOther, otherId, key, compressible.length)).resolves.toBeUndefined();
        await expect(BackupChunkUtilities.open(sealedUnderOther, otherId, key, compressible.length)).rejects.toThrow('is not the data of its id');
        await expect(BackupChunkUtilities.validateStored(plainUnderOther, plainOtherId, undefined, compressible.length))
            .rejects.toThrow('is not the data of its id');
    });

    it('refuses an encrypted chunk stored as it is whose data is not the length the manifest says', async () => {
        const id: string = await BackupChunkUtilities.resolveId(incompressible, key);
        const stored: Buffer = await BackupChunkUtilities.seal(incompressible, id, key, 3);

        await expect(BackupChunkUtilities.validateStored(stored, id, key, incompressible.length - 1)).rejects.toThrow('is not the data of its id');
    });
});