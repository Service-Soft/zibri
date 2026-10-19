/* eslint-disable jsdoc/require-jsdoc */
import { describe, expect, it } from '@jest/globals';

import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about what an upsert's conflict path stores of a
 * value it sets: the same a create or an update stores of it - encrypted, hashed. A file per data
 * source runs them against a repository of its own.
 */

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, uniques: [['handle']] })
export class Credential extends BaseEntity {
    @Property.string()
    handle!: string;

    @Property.string({ encryption: true })
    secret!: string;

    @Property.string({ hash: true })
    pin!: string;

    @Property.string({ encryption: { bindToRow: false }, required: false })
    note?: string;
}

/**
 * Runs every case against the credentials of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param credentialsOf - Reads the repository, once the data source is started.
 */
export function describeUpsertConflictValues(dataSourceName: string, credentialsOf: () => Repository<Credential>): void {
    /**
     * Builds a handle no other test uses.
     * @returns The handle.
     */
    function freshHandle(): string {
        return `credential-${UUIDUtilities.generate()}`;
    }

    describe(`what an upsert stores of a value its conflict path sets, on ${dataSourceName}`, () => {
        it('encrypts a value it sets on an encrypted property, for the row it lands in', async () => {
            const handle: string = freshHandle();
            const created: Credential = await credentialsOf().create({ handle, secret: 'first', pin: '1111' });

            const res: Credential = await credentialsOf().upsert(
                { handle },
                { handle, secret: 'second', pin: '2222' },
                { secret: { set: 'second' } }
            );

            const stored: Credential = await credentialsOf().findById(created.id, { autoDecrypt: false });
            expect(stored.secret).not.toBe('second');
            expect(res.secret).toBe('second');
            expect((await credentialsOf().findById(created.id)).secret).toBe('second');
        });

        it('hashes a value it sets on a hashed property', async () => {
            const handle: string = freshHandle();
            const created: Credential = await credentialsOf().create({ handle, secret: 'first', pin: '1111' });

            await credentialsOf().upsert({ handle }, { handle, secret: 'first', pin: '2222' }, { pin: { set: '2222' } });

            const stored: Credential = await credentialsOf().findById(created.id);
            expect(stored.pin).not.toBe('2222');
            expect(inject(ZIBRI_DI_TOKENS.HASH_SERVICE).isHash(stored.pin)).toBe(true);
        });

        it('encrypts a value it sets on a property encrypted without binding it to the row', async () => {
            const handle: string = freshHandle();
            const created: Credential = await credentialsOf().create({ handle, secret: 'first', pin: '1111', note: 'old' });

            const res: Credential = await credentialsOf().upsert(
                { handle },
                { handle, secret: 'first', pin: '1111' },
                { note: { set: 'new' } }
            );

            const stored: Credential = await credentialsOf().findById(created.id, { autoDecrypt: false });
            expect(stored.note).not.toBe('new');
            expect(res.note).toBe('new');
        });

        it('stores the value the insert gives when the identity is free, not the one the conflict path would set', async () => {
            const handle: string = freshHandle();

            const res: Credential = await credentialsOf().upsert(
                { handle },
                { handle, secret: 'inserted', pin: '1111' },
                { secret: { set: 'conflicted' } }
            );

            expect(res.secret).toBe('inserted');
            expect((await credentialsOf().findById(res.id)).secret).toBe('inserted');
        });

        it('writes each row of a batch the value of the path it took', async () => {
            const held: string = freshHandle();
            const free: string = freshHandle();
            await credentialsOf().create({ handle: held, secret: 'first', pin: '1111' });

            const [changed, inserted] = await credentialsOf().upsertAll(['handle'], [
                { create: { handle: held, secret: 'unused', pin: '1111' }, onConflict: { secret: { set: 'changed' } } },
                { create: { handle: free, secret: 'inserted', pin: '1111' }, onConflict: { secret: { set: 'unused' } } }
            ]);

            expect(changed?.secret).toBe('changed');
            expect(inserted?.secret).toBe('inserted');
            const stored: Credential[] = await credentialsOf().findAll({ where: { handle: { oneOf: [held, free] } } });
            expect(stored.map(c => c.secret).sort()).toEqual(['changed', 'inserted']);
        });
    });
}