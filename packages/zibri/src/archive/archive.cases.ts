import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { runApplicationClockAhead } from '../__testing__/run-application-clock-ahead.function';
import { waitUntil } from '../__testing__/wait-until.function';
import { ChainGap } from '../data-source/chain/chain-gap.model';
import { DeadlineAwareRepositoryDriver } from '../data-source/driver/deadline-aware.repository-driver';
import { ForwardingRepositoryDriver } from '../data-source/driver/forwarding.repository-driver';
import { RepositoryDriverInterface } from '../data-source/driver/repository-driver.interface';
import { WriteObservingRepositoryDriver } from '../data-source/driver/write-observing.repository-driver';
import { Repository } from '../data-source/repository/repository';
import { RepositoryTransaction } from '../data-source/transaction/repository-transaction.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { FileRecord } from '../file/file-record.model';
import { FileStoreInterface } from '../file/stores/file-store.interface';
import { MimeType } from '../http/mime-type.enum';
import { Newable } from '../types/newable.type';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { ArchiveRetentionError } from './archive-retention.error';
import { ArchiveServiceInterface } from './archive-service.interface';
import { ArchiveVerification } from './archive-verification.model';
import { BaseArchivedEntity } from './base-archived-entity.model';
import { Archive } from './decorators/archive.decorator';

/**
 * The cases every data source answers the same way about an archived entity. A file per data source runs them
 * against an entity of its own, registering the file stores `documents` and `offsite`.
 */

/**
 * A receipt, kept for 8 years from the end of the year it was issued in, its scan copied offsite.
 */
@Entity({ allowOrphan: true, chained: true })
@Archive({ retention: { years: 8 }, dateProperty: 'issuedAt', copies: ['offsite'] })
export class ArchivedReceipt extends BaseArchivedEntity {
    /**
     * The team.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;
    /**
     * What it is for.
     */
    @Property.string()
    title!: string;
    /**
     * When it was issued.
     */
    @Property.date()
    issuedAt!: Date;
    /**
     * The scan of it.
     */
    @Property.file({ store: 'documents', allowedMimeTypes: 'all', required: false })
    scan?: string | null;
}

/**
 * The same receipt, kept in a second data source.
 */
@Entity({ allowOrphan: true, chained: true })
export class SecondArchivedReceipt extends ArchivedReceipt {}

/**
 * What every receipt is scanned as.
 */
export const SCAN: Buffer = Buffer.from('%PDF-1.7 the receipt of a taxi');

/**
 * What every receipt is for.
 */
const TITLE: string = 'Taxi to the customer';

/**
 * How long a case that prunes may take: it creates receipts with their files and copies, prunes them, and checks
 * the chain and the files, each a round trip to the data source of the receipts and the one of the anchors.
 */
const PRUNE_CASE_TIMEOUT_IN_MS: number = 20_000;

/**
 * Runs every case against one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param receiptClass - The receipt entity that data source declares.
 * @param documents - The file store `documents`, whose bytes the cases change past the file service.
 */
export function describeArchive(
    dataSourceName: string,
    receiptClass: Newable<ArchivedReceipt>,
    documents: () => FileStoreInterface
): void {
    function receipts(): Repository<ArchivedReceipt> {
        return inject(repositoryTokenFor(receiptClass));
    }

    function archive(): ArchiveServiceInterface {
        return inject(ZIBRI_DI_TOKENS.ARCHIVE_SERVICE);
    }

    async function asTenant<T>(tenant: string, work: () => Promise<T>): Promise<T> {
        return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenant, work);
    }

    async function findRecord(tenant: string, id: string): Promise<FileRecord | undefined> {
        return await asTenant(tenant, async () => await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).findFile(id));
    }

    async function waitUntilGone(tenant: string, ids: string[]): Promise<void> {
        await waitUntil(async () => (await Promise.all(ids.map(async id => await findRecord(tenant, id)))).every(f => f == undefined));
    }

    /**
     * Creates a receipt with a scan, as the code of an application does.
     * @param tenant - The tenant.
     * @param data - What else the receipt is created with.
     * @returns The receipt.
     */
    async function createReceipt(tenant: string, data: Partial<ArchivedReceipt> = {}): Promise<ArchivedReceipt> {
        return await asTenant(tenant, async () => {
            const scan: FileRecord = await inject(ZIBRI_DI_TOKENS.FILE_SERVICE)
                .store({ store: 'documents', name: 'taxi.pdf', mimeType: MimeType.PDF, data: SCAN });
            return await receipts().create({ title: TITLE, issuedAt: new Date(), scan: scan.id, ...data });
        });
    }

    function filesOf(receipt: ArchivedReceipt): string[] {
        return [receipt.scan ?? '', ...receipt.archivedFiles.flatMap(f => f.copies)];
    }

    /**
     * The store of the receipts, beneath the observers of its writes, the way someone with access to the data
     * source writes to it.
     * @returns The driver.
     */
    function storeOfReceipts(): RepositoryDriverInterface<ArchivedReceipt, RepositoryTransaction> {
        let driver: RepositoryDriverInterface<ArchivedReceipt, RepositoryTransaction> = receipts()['driver'];
        while (isAboveTheStore(driver)) {
            driver = driver['inner'];
        }
        return driver;
    }

    function isAboveTheStore(
        driver: RepositoryDriverInterface<ArchivedReceipt, RepositoryTransaction>
    ): driver is ForwardingRepositoryDriver<ArchivedReceipt, RepositoryTransaction> {
        return driver instanceof DeadlineAwareRepositoryDriver || driver instanceof WriteObservingRepositoryDriver;
    }

    async function verify(tenantId: string): Promise<ArchiveVerification> {
        return await archive().resolveVerification({ entityClass: receiptClass, tenantId });
    }

    describe(`an archived entity, on ${dataSourceName}`, () => {
        afterEach(() => {
            jest.useRealTimers();
        });

        it('counts the retention from the end of the year of its date, and records its file with a copy in the other store', async () => {
            const tenant: string = UUIDUtilities.generate();
            const receipt: ArchivedReceipt = await createReceipt(tenant, { issuedAt: new Date('2026-03-15T10:00:00Z') });

            expect(receipt.retainUntil).toEqual(new Date('2035-01-01T00:00:00.000Z'));
            expect(receipt.archivedFiles).toHaveLength(1);
            const [file] = receipt.archivedFiles;
            const original: FileRecord | undefined = await findRecord(tenant, receipt.scan ?? '');
            expect(file?.id).toBe(receipt.scan);
            expect(file?.sha256).toBe(original?.sha256);
            expect(file?.copies).toHaveLength(1);
            const copy: FileRecord | undefined = await findRecord(tenant, file?.copies[0] ?? '');
            expect(copy).toMatchObject({ storeName: 'offsite', sha256: original?.sha256, name: 'taxi.pdf' });
            expect(await asTenant(tenant, async () => await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).read(copy?.id ?? ''))).toEqual(SCAN);
            // as read back from the store, which its chain hashes the same as when it was written
            expect(await verify(tenant)).toMatchObject({ intact: true, fileProblems: [], checkedFiles: 2 });
        });

        it('takes a retention of its own on create, longer or shorter than that of its type', async () => {
            const tenant: string = UUIDUtilities.generate();
            const longer: Date = new Date('2050-01-01T00:00:00Z');
            const shorter: Date = new Date(Date.now() + Ms.HOUR);

            expect((await createReceipt(tenant, { retainUntil: longer })).retainUntil).toEqual(longer);
            expect((await createReceipt(tenant, { retainUntil: shorter })).retainUntil).toEqual(shorter);
            expect(await verify(tenant)).toMatchObject({ intact: true });
        });

        it('refuses to change a row, its retention included, and to delete it before its retention ended', async () => {
            const tenant: string = UUIDUtilities.generate();
            const receipt: ArchivedReceipt = await createReceipt(tenant, { issuedAt: new Date('2026-03-15T10:00:00Z') });

            await expect(asTenant(tenant, async () => await receipts().updateById(receipt.id, { title: 'Train' })))
                .rejects.toThrow(`The rows of ${receiptClass.name} are archived, and are never changed.`);
            await expect(asTenant(tenant, async () => await receipts().updateById(receipt.id, { retainUntil: new Date() })))
                .rejects.toThrow('are never changed');
            await expect(asTenant(tenant, async () => await receipts().deleteById(receipt.id))).rejects.toThrow(
                `The ${receiptClass.name} "${receipt.id}" is archived until 2035-01-01T00:00:00.000Z, and can be deleted from then on.`
            );
            await expect(asTenant(tenant, async () => await receipts().deleteAll({ title: TITLE })))
                .rejects.toThrow(ArchiveRetentionError);
            await expect(receipts().prune({ title: TITLE }))
                .rejects.toThrow('Prune them with prune of ZIBRI_DI_TOKENS.ARCHIVE_SERVICE');
            expect(await findRecord(tenant, receipt.scan ?? '')).toBeDefined();
            expect(await verify(tenant)).toMatchObject({ intact: true });
        });

        it('deletes a row once its retention ended, with its file and its copy, and the chain holds', async () => {
            const tenant: string = UUIDUtilities.generate();
            const kept: ArchivedReceipt = await createReceipt(tenant);
            const due: ArchivedReceipt = await createReceipt(tenant, { retainUntil: new Date(Date.now() + Ms.HOUR) });
            const after: ArchivedReceipt = await createReceipt(tenant);

            runApplicationClockAhead(2 * Ms.HOUR);
            await asTenant(tenant, async () => await receipts().deleteById(due.id));
            await expect(asTenant(tenant, async () => await receipts().deleteById(kept.id))).rejects.toThrow(ArchiveRetentionError);

            await waitUntilGone(tenant, filesOf(due));
            expect(await findRecord(tenant, kept.scan ?? '')).toBeDefined();
            // the row was removed from the middle of the chain, which records it
            expect(await verify(tenant)).toMatchObject({
                intact: true,
                chains: [{ tenantId: tenant, verification: { intact: true, newestSequence: after.chainSequence } }]
            });
        });

        it('tells a row that was changed past the repository', async () => {
            const tenant: string = UUIDUtilities.generate();
            const [, second] = [await createReceipt(tenant), await createReceipt(tenant), await createReceipt(tenant)];

            await storeOfReceipts().updateAll({ where: { id: second?.id }, data: { title: 'rewritten' } });

            expect(await verify(tenant)).toMatchObject({
                intact: false,
                chains: [{ verification: { intact: false, brokenAtSequence: 2, reason: 'The row is not as it was written.' } }]
            });
        });

        it('tells a row that was removed past the repository', async () => {
            const tenant: string = UUIDUtilities.generate();
            const [, second] = [await createReceipt(tenant), await createReceipt(tenant), await createReceipt(tenant)];

            await storeOfReceipts().remove([second?.id ?? ''], undefined, undefined);

            expect(await verify(tenant)).toMatchObject({
                intact: false,
                chains: [{ verification: { intact: false, brokenAtSequence: 3, reason: 'The rows from 2 to 2 are missing.' } }]
            });
        });

        it('tells a file whose bytes changed, and a file whose record was changed along with them', async () => {
            const tenant: string = UUIDUtilities.generate();
            const receipt: ArchivedReceipt = await createReceipt(tenant);
            const record: FileRecord | undefined = await findRecord(tenant, receipt.scan ?? '');

            await documents().put(record?.key ?? '', Readable.from([Buffer.from('%PDF-1.7 another receipt')]));

            const changedBytes: ArchiveVerification = await verify(tenant);
            expect(changedBytes.intact).toBe(false);
            expect(changedBytes.chains).toMatchObject([{ verification: { intact: true } }]);
            // the copy offsite holds
            expect(changedBytes.fileProblems)
                .toEqual([expect.objectContaining({ rowId: receipt.id, fileId: receipt.scan, reason: 'changed' })]);

            await inject(repositoryTokenFor(FileRecord))
                .updateById(record?.id ?? '', { sha256: 'f'.repeat(64) }, { acrossTenants: true });

            const changedRecord: ArchiveVerification = await verify(tenant);
            expect(changedRecord.fileProblems).toEqual([expect.objectContaining({ fileId: receipt.scan, reason: 'changed' })]);
            expect(changedRecord.fileProblems[0]?.message).toContain('another SHA-256 than the row recorded');
        });

        it('prunes the rows whose retention ended with their files, keeps the rest, and the chain holds and goes on', async () => {
            const tenant: string = UUIDUtilities.generate();
            const old: ArchivedReceipt = await createReceipt(tenant, { retainUntil: new Date(Date.now() + Ms.HOUR) });
            const kept: ArchivedReceipt = await createReceipt(tenant, { retainUntil: new Date(Date.now() + (3 * Ms.HOUR)) });
            // due before the one before it, so it leaves a gap in the chain
            const outOfOrder: ArchivedReceipt = await createReceipt(tenant, { retainUntil: new Date(Date.now() + Ms.HOUR) });
            const newest: ArchivedReceipt = await createReceipt(tenant);

            runApplicationClockAhead(2 * Ms.HOUR);
            const due: ArchivedReceipt[] = await archive().findDue(receiptClass, { acrossTenants: true, limit: 1000 });
            expect(due.map(r => r.id)).toEqual(expect.arrayContaining([old.id, outOfOrder.id]));
            expect(due.map(r => r.id)).not.toContain(kept.id);

            expect(await archive().prune(receiptClass)).toBeGreaterThanOrEqual(2);

            const left: ArchivedReceipt[] = await asTenant(
                tenant,
                async () => await receipts().findAll({ order: { chainSequence: 'ASC' } })
            );
            expect(left.map(r => r.id)).toEqual([kept.id, newest.id]);
            await waitUntilGone(tenant, [...filesOf(old), ...filesOf(outOfOrder)]);
            expect(await findRecord(tenant, kept.scan ?? '')).toBeDefined();
            expect(await verify(tenant)).toMatchObject({ intact: true, chains: [{ verification: { intact: true, newestSequence: 4 } }] });

            const next: ArchivedReceipt = await createReceipt(tenant);
            expect(next.chainSequence).toBe(5);
            expect(await verify(tenant)).toMatchObject({ intact: true, chains: [{ verification: { newestSequence: 5 } }] });
        }, PRUNE_CASE_TIMEOUT_IN_MS);

        it('links the next row after the newest row once it was pruned', async () => {
            const tenant: string = UUIDUtilities.generate();
            const kept: ArchivedReceipt = await createReceipt(tenant);
            await createReceipt(tenant, { retainUntil: new Date(Date.now() + Ms.HOUR) });

            runApplicationClockAhead(2 * Ms.HOUR);
            await archive().prune(receiptClass);
            const next: ArchivedReceipt = await createReceipt(tenant);

            expect([kept.chainSequence, next.chainSequence]).toEqual([1, 3]);
            expect(await verify(tenant)).toMatchObject({ intact: true, chains: [{ verification: { intact: true, newestSequence: 3 } }] });
        }, PRUNE_CASE_TIMEOUT_IN_MS);

        it('tells a gap that was not recorded by the application', async () => {
            const tenant: string = UUIDUtilities.generate();
            await createReceipt(tenant);
            const due: ArchivedReceipt = await createReceipt(tenant, { retainUntil: new Date(Date.now() + Ms.HOUR) });
            await createReceipt(tenant);
            runApplicationClockAhead(2 * Ms.HOUR);
            await archive().prune(receiptClass);
            const gaps: Repository<ChainGap> = inject(repositoryTokenFor(ChainGap));
            const gap: ChainGap = await gaps.findOne({ where: { chain: tenant } });

            // what removing a row past the repository and recording it as pruned would take
            await gaps.updateById(gap.id, { hash: `${due.chainHash}-forged` });

            const reason: string = 'The row recorded as removed was not recorded by this application.';
            expect(await verify(tenant)).toMatchObject({
                intact: false,
                chains: [{ verification: { intact: false, brokenAtSequence: 2, reason } }]
            });
        }, PRUNE_CASE_TIMEOUT_IN_MS);
    });
}