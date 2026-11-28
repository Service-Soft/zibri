import type { ZibriApplication } from '../application/application';
import { ArchiveUtilities } from '../archive/archive.utilities';
import { getRegisteredProvidersOfVariant } from '../di/get-registered-providers-of-variant.function';
import { inject } from '../di/inject.function';
import { DiVariants } from '../di/models/di-variant.model';
import { BaseEntity } from '../entity/base-entity.model';
import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { InternalError } from '../error-handling/internal-error.model';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { FilePropertyUtilities, StoredFilePropertyMetadata } from './file-property.utilities';
import { ServedFilesMetadata } from './served-files-metadata.model';
import { isFileStore } from './stores/file-store.interface';
import { TenantFileStore } from './tenant/tenant-file-store.model';

/**
 * A file property of an entity, and the name of the store it keeps its files in.
 */
type FileStoreOfProperty = {
    /**
     * The entity.
     */
    entity: Newable<BaseEntity>,
    /**
     * The key of the property.
     */
    key: string,
    /**
     * What each file is declared as.
     */
    file: StoredFilePropertyMetadata,
    /**
     * The name of the store, as the property gives it or its DI token provides it.
     */
    storeName: string
};

/**
 * Validates the files the entities of an application keep in a file store, whatever file service the application
 * registers: each in a place a row and its download route name it, in a store the application registers or a tenant
 * may configure, and written by a controller whose bodies hold no file it would hand to a column holding bytes.
 * @param app - The application that starts.
 * @throws An InternalError naming the first property that is not.
 */
export function validateStoredFileProperties(app: ZibriApplication): void {
    const entities: Set<Newable<BaseEntity>> = new Set(app.options.dataSources.flatMap(d => inject(d).entities));
    for (const entity of entities) {
        FilePropertyUtilities.validateStoredFilePlacement(entity);
    }
    validateStoresKnown(entities);
    for (const controller of app.options.controllers) {
        for (const route of MetadataUtilities.getControllerRoutes(controller)) {
            const served: ServedFilesMetadata | undefined = MetadataUtilities.getRouteServedFiles(controller, route.controllerMethod);
            if (served != undefined) {
                validateNoFileInColumn(controller, served);
            }
        }
    }
}

/**
 * Validates that every store the entities keep files in is registered, or may be configured by a tenant.
 * @param entities - The entities of the application.
 * @throws An InternalError naming the first property of a store that is neither.
 */
function validateStoresKnown(entities: Set<Newable<BaseEntity>>): void {
    // every store a DI token names is read here, so that a token without a provider stops the start rather than the
    // first write of a file
    const named: FileStoreOfProperty[] = [...entities]
        .flatMap(entity => FilePropertyUtilities.resolveStoredFileProperties(entity)
            .map(({ key, file }) => ({ entity, key, file, storeName: FilePropertyUtilities.resolveStoreName(file) })));
    // a tenant may configure a store of any name, standing in for the application's
    if (entities.has(TenantFileStore)) {
        return;
    }
    const storeNames: Set<string> = resolveRegisteredStoreNames();
    for (const { entity, key, file, storeName } of named) {
        if (!storeNames.has(storeName)) {
            const namedBy: string = typeof file.store === 'string' ? '' : `, named by ${file.store.key}`;
            throw new InternalError(
                `${entity.name}.${key} keeps its files in the file store "${storeName}"${namedBy}, which is not registered. `
                + 'Register one with @FileStore().'
            );
        }
    }
    for (const entity of entities) {
        for (const store of ArchiveUtilities.findMetadata(entity)?.copies ?? []) {
            if (!storeNames.has(store)) {
                throw new InternalError(
                    `${entity.name} copies its files into the file store "${store}", which is not registered. `
                    + 'Register one with @FileStore().'
                );
            }
        }
    }
}

/**
 * Resolves the names of the file stores the application registers.
 * @returns The names.
 */
function resolveRegisteredStoreNames(): Set<string> {
    const res: Set<string> = new Set();
    for (const provider of getRegisteredProvidersOfVariant(DiVariants.FILE_STORE)) {
        const store: unknown = inject(provider.token);
        if (isFileStore(store)) {
            res.add(store.name);
        }
    }
    return res;
}

/**
 * Validates that the multipart bodies of a controller writing the files of an entity to a file store hold no file
 * that the entity keeps in its column, which the controller would hand over as the upload rather than its bytes.
 * @param controller - The controller.
 * @param served - What its route serving the files declares.
 * @throws An InternalError naming the file.
 */
function validateNoFileInColumn(controller: Function, served: ServedFilesMetadata): void {
    for (const body of served.bodyClasses) {
        for (const [key, property] of ObjectUtilities.entries(MetadataUtilities.getModelProperties(body))) {
            const file: PropertyMetadata = property.type === 'array' ? property.items : property;
            if (file.type === 'file' && !FilePropertyUtilities.isInStore(file)) {
                throw new InternalError([
                    `${controller.name}: ${body.name}.${key} is a file kept in the column of ${served.entityClass.name}, `
                    + 'while its other files are kept in a file store, whose bodies the controller takes as multipart.',
                    `Name a store for ${key} too, or leave it out of ${body.name}.`
                ]);
            }
        }
    }
}