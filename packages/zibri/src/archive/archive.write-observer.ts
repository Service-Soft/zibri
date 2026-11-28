import type { ZibriApplication } from '../application/application';
import { RestoreContextUtilities } from '../backup/restore-context.utilities';
import { BaseChainedEntity } from '../data-source/chain/base-chained-entity.model';
import { ChainGap } from '../data-source/chain/chain-gap.model';
import { ChainServiceInterface } from '../data-source/chain/chain-service.interface';
import { TransactionUtilities } from '../data-source/transaction/transaction.utilities';
import { EntityWrite, EntityWriteObserver, ObservedWrite, WrittenRows } from '../data-source/write-observers/entity-write-observer.model';
import { EntityWriteObserverRegistry } from '../data-source/write-observers/entity-write-observer.registry';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { EntityTenant } from '../entity/models/entity-tenant.model';
import { ArchivedEntityUtilities } from '../entity/utilities/archived-entity.utilities';
import { InternalError } from '../error-handling/internal-error.model';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';
import { ArchiveMetadata } from './archive-options.model';
import { ArchiveRetentionError } from './archive-retention.error';
import { ArchiveUtilities } from './archive.utilities';

/**
 * Keeps the rows of an archived entity for their retention, on every data source and however the repository got to
 * the write: a row is only created, and removed once its retention ended, which its chain records first. The copies
 * of the files of a removed row are deleted with it.
 */
export class ArchiveWriteObserver implements EntityWriteObserver {
    /**
     * What a row removed is read with: its retention, its place in its chain and its files.
     */
    readonly properties: string[];

    constructor(private readonly entityClass: Newable<BaseChainedEntity>) {
        const tenant: EntityTenant | undefined = MetadataUtilities.getEntityMetadata(entityClass)?.tenant;
        this.properties = [
            'retainUntil',
            'chainSequence',
            'chainHash',
            'archivedFiles',
            ...tenant == undefined || tenant === 'shared' ? [] : [tenant.property]
        ];
    }

    /**
     * Registers an observer for every archived entity of an application, whatever archive service it registers, so
     * that each of its repositories keeps the rows for their retention.
     * @param app - The application that starts.
     * @throws An InternalError for an archived entity that is not chained or does not extend `BaseArchivedEntity`.
     */
    static registerFor(app: ZibriApplication): void {
        const registry: EntityWriteObserverRegistry = inject(EntityWriteObserverRegistry);
        const entities: Set<Newable<BaseEntity>> = new Set(app.options.dataSources.flatMap(d => inject(d).entities));
        let archives: boolean = false;
        for (const entity of entities) {
            const metadata: ArchiveMetadata | undefined = ArchiveUtilities.findMetadata(entity);
            if (metadata == undefined) {
                continue;
            }
            ArchiveUtilities.validateArchivable(entity, metadata);
            if (ArchivedEntityUtilities.isArchived(entity)) {
                registry.register(entity, new ArchiveWriteObserver(entity));
                archives = true;
            }
        }
        if (archives) {
            validateEntitiesRegistered(ArchiveWriteObserver.name, app, ChainGap);
        }
    }

    /**
     * Whether a write needs a transaction: a removal, whose rows are recorded in their chains before it, so that a
     * removal that fails records none.
     * @param write - The write.
     * @returns True for a removal.
     */
    requiresTransaction(write: EntityWrite): boolean {
        return write.operation === 'remove' && !RestoreContextUtilities.isRestoring();
    }

    /**
     * Whether the rows as they were are read before a write: of a removal, whose copies are deleted with it.
     * @param write - The write.
     * @returns True for a removal.
     */
    followsBefore(write: EntityWrite): boolean {
        return write.operation === 'remove' && !RestoreContextUtilities.isRestoring();
    }

    /**
     * Refuses a write that changes a row, and the removal of a row whose retention has not ended. Records the rows a
     * removal takes in their chains.
     * @param write - The write about to be made.
     * @throws An ArchiveRetentionError naming the first row whose retention has not ended.
     */
    async validateWrite(write: ObservedWrite): Promise<void> {
        // a restore puts the rows, their chains and their files back as they were stored
        if (RestoreContextUtilities.isRestoring()) {
            return;
        }
        switch (write.operation) {
            case 'insert': {
                return;
            }
            case 'remove': {
                await this.validateRemoval(write);
                return;
            }
            case 'save':
            case 'updateEach':
            case 'updateAll':
            case 'upsert': {
                // the repository refuses these with a conflict already, so only a write past it gets here
                throw new InternalError(`The rows of "${this.entityClass.name}" are archived, and are only created.`);
            }
        }
    }

    /**
     * Deletes the copies of the files of the rows a removal took, once it is committed. The files themselves go as
     * those of any row.
     * @param written - The committed write.
     */
    async handleWritten(written: WrittenRows): Promise<void> {
        if (written.operation !== 'remove' || RestoreContextUtilities.isRestoring()) {
            return;
        }
        const copies: string[] = written.before
            .flatMap(row => ArchiveUtilities.isArchivedRow(row) ? row.archivedFiles.flatMap(f => f.copies) : []);
        if (copies.length) {
            await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).deleteRemovedFiles(copies);
        }
    }

    private async validateRemoval(write: ObservedWrite): Promise<void> {
        const rows: object[] = (await write.resolveRowWrites()).flatMap(rowWrite => rowWrite.existing ?? []);
        if (!rows.length) {
            return;
        }
        const now: number = Date.now();
        for (const row of rows) {
            const retainUntil: unknown = Reflect.get(row, 'retainUntil');
            if (!(retainUntil instanceof Date)) {
                throw new InternalError(`A row of "${this.entityClass.name}" about to be removed was read without its retainUntil.`);
            }
            if (retainUntil.getTime() > now) {
                throw new ArchiveRetentionError(this.entityClass.name, String(Reflect.get(row, 'id')), retainUntil);
            }
        }
        const chainService: ChainServiceInterface = inject(ZIBRI_DI_TOKENS.CHAIN_SERVICE);
        if (chainService.recordRemovedRows == undefined) {
            throw new InternalError([
                `The rows of "${this.entityClass.name}" are removed from their chains once their retention ended.`,
                'The chain service of ZIBRI_DI_TOKENS.CHAIN_SERVICE needs to implement recordRemovedRows for that.'
            ]);
        }
        TransactionUtilities.validateNotSpanning(
            write.transaction,
            `${this.entityClass.name} is chained, and a row of a chain cannot be restored`
        );
        await chainService.recordRemovedRows(this.entityClass, rows, write.transaction);
    }
}