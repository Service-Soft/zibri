import { Readable } from 'node:stream';

import { RepositoryTransaction } from '../data-source/transaction/repository-transaction.type';
import { FileRecord } from './file-record.model';
import { StoreFileData } from './store-file-data.model';
import { TenantFileStore, TenantFileStoreCreateData } from './tenant/tenant-file-store.model';

/**
 * Stores, reads and deletes files in the file stores of the application and its tenants. Each stored file is a
 * `FileRecord` of the current tenant, and files of the same content in the same store share their bytes.
 */
export interface FileServiceInterface {
    /**
     * Stores a file in a store, in the current tenant: the tenant's own store of that name when it configured one,
     * else the application's.
     * @param data - The bytes, what the file is, and the store.
     * @param transaction - The transaction the row is created in. The bytes are written before it, and those of a
     * transaction rolled back are deleted by `FileCleanupCronJob`.
     * @returns The row of the file.
     */
    store: (data: StoreFileData, transaction?: RepositoryTransaction) => Promise<FileRecord>,
    /**
     * Stores a copy of a file of the current tenant in another store, as a file of its own, once its bytes match the
     * SHA-256 they were stored with.
     * @param id - The id of the file.
     * @param store - The name of the store the copy is kept in.
     * @param transaction - The transaction the row of the copy is created in, which may hold the row of the file.
     * @returns The row of the copy.
     * @throws A NotFoundError when the tenant has no such file, a FileHashMismatchError when the bytes do not match.
     */
    copy: (id: string, store: string, transaction?: RepositoryTransaction) => Promise<FileRecord>,
    /**
     * Finds the row of a file of the current tenant.
     * @param id - The id of the file.
     * @returns The row, or undefined when the tenant has no such file.
     */
    findFile: (id: string) => Promise<FileRecord | undefined>,
    /**
     * Finds the rows of several files of the current tenant in one go.
     * @param ids - The ids of the files.
     * @param transaction - The transaction to read them in, which may hold rows it created.
     * @returns The rows the tenant has, in any order.
     */
    findFiles: (ids: string[], transaction?: RepositoryTransaction) => Promise<FileRecord[]>,
    /**
     * Reads the bytes of a file of the current tenant, once they match the SHA-256 they were stored with.
     * @param id - The id of the file.
     * @returns The bytes.
     * @throws A NotFoundError when the tenant has no such file, a FileHashMismatchError when the bytes do not match.
     */
    read: (id: string) => Promise<Buffer>,
    /**
     * Reads the bytes of a file of the current tenant as a stream, which fails at its end with a FileHashMismatchError
     * when the bytes do not match the SHA-256 they were stored with.
     * @param id - The id of the file.
     * @returns The bytes.
     * @throws A NotFoundError when the tenant has no such file.
     */
    readStream: (id: string) => Promise<Readable>,
    /**
     * Deletes a file of the current tenant. Its bytes go with the last row of the same content in its store.
     * @param id - The id of the file.
     * @param transaction - The transaction the row is deleted in. The bytes go once it is committed.
     * @throws A NotFoundError when the tenant has no such file.
     */
    delete: (id: string, transaction?: RepositoryTransaction) => Promise<void>,
    /**
     * Deletes the files a write of a repository removed from its rows, of whichever tenant the rows were of, such as
     * those of a row deleted or a file replaced. A file that is gone already is left out. Called by the repository of
     * an entity keeping files in a file store, once the write is committed.
     * @param ids - The ids of the files.
     */
    deleteRemovedFiles: (ids: string[]) => Promise<void>,
    /**
     * Deletes the bytes in every store that no row references and that were not written for a day, such as those
     * of a transaction that was rolled back. Called by `FileCleanupCronJob`.
     * @returns How many keys were deleted.
     */
    deleteUnreferencedFiles: () => Promise<number>,
    /**
     * Adds a file store of a tenant's own, which its files of that store name are kept in from then on. Writes and
     * deletes a small file on it first.
     * @param tenantId - The tenant.
     * @param data - What configures the store, its secret as it is.
     * @returns The store, as it is stored.
     * @throws A BadRequestError when it is of no kind the application lists, does not match its kind's models, or
     * cannot be written to.
     */
    createTenantFileStore: (tenantId: string, data: TenantFileStoreCreateData) => Promise<TenantFileStore>,
    /**
     * Finds the file stores a tenant configured.
     * @param tenantId - The tenant.
     * @returns Its stores.
     */
    findTenantFileStores: (tenantId: string) => Promise<TenantFileStore[]>,
    /**
     * Deletes a file store of a tenant.
     * @param tenantId - The tenant.
     * @param id - The id of the store.
     * @throws A NotFoundError when the tenant has no such store, a ConflictError while files are kept in it.
     */
    deleteTenantFileStore: (tenantId: string, id: string) => Promise<void>
}