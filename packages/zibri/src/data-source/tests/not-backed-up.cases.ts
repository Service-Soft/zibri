import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { describe, expect, it } from '@jest/globals';

import { BackupEntity } from '../../backup/backup-entity.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about an entity declared `backedUp: false`: a
 * backup leaves its rows out, and a restore keeps the rows it holds now. A file per data source runs
 * them against a data source of its own.
 */

/**
 * A row that belongs to the data, which a backup takes and a restore replaces.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class BackedUpNote extends BaseEntity {
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string()
    text!: string;
}

/**
 * A row that belongs to the instances running now, which a backup leaves out and a restore keeps.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, backedUp: false })
export class KeptGrant extends BaseEntity {
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string()
    name!: string;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.oneToMany({ target: () => KeptRenewal, inverseSide: 'grant' })
    renewals!: KeptRenewal[];
}

/**
 * A row of the instances that points at another one. A data source declares it before the one it
 * points at, which is not the order a restore can put the two back in.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, backedUp: false })
export class KeptRenewal extends BaseEntity {
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.manyToOne({ target: () => KeptGrant, joinColumn: 'grantId', inverseSide: 'renewals' })
    grant?: KeptGrant;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string({ format: 'uuid' })
    grantId!: string;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string()
    reason!: string;
}

/**
 * Runs every case against one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param dataSourceOf - Reads the data source, once it is started.
 */
export function describeNotBackedUp(dataSourceName: string, dataSourceOf: () => DataSourceInterface): void {
    describe(`an entity that is not backed up, on ${dataSourceName}`, () => {
        it('stays out of a backup, and keeps its rows through a restore while the others are replaced', async () => {
            const dataSource: DataSourceInterface = dataSourceOf();
            const notes: Repository<BackedUpNote> = dataSource.getRepository(BackedUpNote);
            const grants: Repository<KeptGrant> = dataSource.getRepository(KeptGrant);
            await notes.create({ text: 'backed up' });
            await grants.create({ name: 'held when the backup was taken' });
            // the data source ignores which backup the data is for
            const backup: Buffer = await buffer(await dataSource.createBackupData(Object.assign(new BackupEntity(), { name: 'kept' })));

            await notes.deleteAll({});
            await grants.deleteAll({});
            await notes.create({ text: 'written after the backup' });
            await grants.create({ name: 'held now' });

            await dataSource.restoreBackup(Readable.from([backup]));

            expect((await notes.findAll()).map(n => n.text)).toEqual(['backed up']);
            expect((await grants.findAll()).map(g => g.name)).toEqual(['held now']);
        });

        it('keeps rows that point at other kept rows, whichever order their entities are declared in', async () => {
            const dataSource: DataSourceInterface = dataSourceOf();
            const grants: Repository<KeptGrant> = dataSource.getRepository(KeptGrant);
            const renewals: Repository<KeptRenewal> = dataSource.getRepository(KeptRenewal);
            const backup: Buffer = await buffer(
                await dataSource.createBackupData(Object.assign(new BackupEntity(), { name: 'kept renewals' }))
            );
            await renewals.deleteAll({});
            await grants.deleteAll({});
            const grant: KeptGrant = await grants.create({ name: 'held now' });
            await renewals.create({ grantId: grant.id, reason: 'renewed now' });

            await dataSource.restoreBackup(Readable.from([backup]));

            expect((await renewals.findAll()).map(r => [r.grantId, r.reason])).toEqual([[grant.id, 'renewed now']]);
        });
    });
}