import type { ZibriApplication } from '../application/application';
import { EntityWrite, EntityWriteObserver, WrittenRows } from '../data-source/write-observers/entity-write-observer.model';
import { EntityWriteObserverRegistry } from '../data-source/write-observers/entity-write-observer.registry';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Newable } from '../types/newable.type';
import { FilePropertyUtilities, StoredFileProperty } from './file-property.utilities';
import { FileServiceInterface } from './file-service.interface';

/**
 * Deletes the files a write to an entity keeping files in a file store removed from its rows: those of a row
 * removed, and a file replaced or removed by an update. A row kept, such as one soft deleted, keeps its files.
 */
export class StoredFileWriteObserver implements EntityWriteObserver {
    /**
     * The properties holding the files, which are read of a row before it is removed or updated.
     */
    readonly properties: string[];

    constructor(
        private readonly fileProperties: StoredFileProperty[],
        private readonly fileService: FileServiceInterface
    ) {
        this.properties = fileProperties.map(p => p.key);
    }

    /**
     * Registers an observer for every entity of an application that keeps files in a file store, so that each of its
     * repositories deletes the files its writes remove, on every data source.
     * @param app - The application that starts.
     */
    static registerFor(app: ZibriApplication): void {
        const registry: EntityWriteObserverRegistry = inject(EntityWriteObserverRegistry);
        const entities: Set<Newable<BaseEntity>> = new Set(app.options.dataSources.flatMap(d => inject(d).entities));
        for (const entity of entities) {
            const fileProperties: StoredFileProperty[] = FilePropertyUtilities.resolveStoredFileProperties(entity);
            if (fileProperties.length) {
                // given once rather than resolved by every write
                registry.register(entity, new StoredFileWriteObserver(fileProperties, inject(ZIBRI_DI_TOKENS.FILE_SERVICE)));
            }
        }
    }

    /**
     * Whether the rows as they were are read before a write: of a removal, and of a write that names a file.
     * @param write - The write.
     * @returns True when the write can take a file off a row.
     */
    followsBefore(write: EntityWrite): boolean {
        return write.operation === 'remove' || write.data.some(row => this.properties.some(key => Object.hasOwn(row, key)));
    }

    /**
     * Deletes the files the rows held before the write and hold no more, once it is committed, so that a write rolled
     * back keeps them.
     * @param written - The committed write.
     */
    async handleWritten(written: WrittenRows): Promise<void> {
        // a removal takes every file of its rows, any other write only those of the properties it names
        const changed: StoredFileProperty[] = written.operation === 'remove'
            ? this.fileProperties
            : this.fileProperties.filter(p => written.data.some(row => Object.hasOwn(row, p.key)));
        const kept: Set<string> = new Set(written.after.flatMap(row => FilePropertyUtilities.resolveFileIds(row, this.fileProperties)));
        const removed: string[] = written.before
            .flatMap(row => FilePropertyUtilities.resolveFileIds(row, changed))
            .filter(id => !kept.has(id));
        if (removed.length) {
            await this.fileService.deleteRemovedFiles(removed);
        }
    }
}