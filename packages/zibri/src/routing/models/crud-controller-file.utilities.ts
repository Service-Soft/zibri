import { Readable } from 'node:stream';

import { ArchiveUtilities } from '../../archive/archive.utilities';
import { ChainUtilities } from '../../data-source/chain/chain.utilities';
import { Repository } from '../../data-source/repository/repository';
import { RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { SpanningTransaction } from '../../data-source/transaction/spanning-transaction.model';
import { TransactionUtilities } from '../../data-source/transaction/transaction.utilities';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { ValidationError } from '../../error-handling/errors/validation.error';
import { FilePropertyUtilities, StoredFileProperty } from '../../file/file-property.utilities';
import { FileRecord } from '../../file/file-record.model';
import { FileServiceInterface } from '../../file/file-service.interface';
import { FileExtension } from '../../http/file-extension.model';
import { MimeTypeUtilities } from '../../http/mime-type.utilities';
import { $ts } from '../../localization/translate.function';
import { FileResponse } from '../../parsing/form-data/file-response.model';
import { File } from '../../parsing/form-data/file.model';
import { FormData } from '../../parsing/form-data/form-data.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { FsUtilities } from '../../utilities/fs.utilities';
import { IsRequiredValidationProblem } from '../../validation/validation-problem.model';

/**
 * The ids a write stores in the file properties of a row: one or none for a file, a list for an array.
 */
type StoredFileIds = Record<string, string | string[] | null>;

/**
 * The transaction a row and its files are written in.
 */
type WriteTransactions<T extends BaseEntity> = {
    /**
     * The transaction, as the file service takes it.
     */
    files: RepositoryTransaction,
    /**
     * The same transaction, as the repository of the entity takes it.
     */
    row: RepositoryTransaction<T> | undefined
};

/**
 * Whether a name has an extension, as the name of a downloaded file is typed.
 * @param name - The name.
 * @returns True when it has a dot.
 */
function hasExtension(name: string): name is `${string}.${string}` {
    return name.includes('.');
}

/**
 * How a `CrudController` writes, deletes and serves the files of an entity kept in a file store: each file part of a
 * multipart body is stored through the file service, in the transaction the row is written in, and the column holds
 * the id of its `FileRecord`.
 */
export abstract class CrudControllerFileUtilities {
    private static get fileService(): FileServiceInterface {
        return inject(ZIBRI_DI_TOKENS.FILE_SERVICE);
    }

    /**
     * Creates a row from a multipart body, storing its files first.
     * @param repo - The repository of the entity.
     * @param properties - The file properties of the entity kept in a file store.
     * @param form - The body.
     * @returns The row.
     */
    static async create<T extends BaseEntity, CreateData extends DeepPartial<T>, UpdateData extends DeepPartial<T>>(
        repo: Repository<T, CreateData, UpdateData>,
        properties: StoredFileProperty[],
        form: FormData<CreateData>
    ): Promise<T> {
        try {
            return await this.runInTransaction(repo, async ({ files, row }) => {
                const stored: StoredFileIds = await this.storeFiles(form.value, properties, files);
                return await repo.create({ ...form.value, ...stored }, { transaction: row });
            });
        }
        finally {
            await form.cleanup();
        }
    }

    /**
     * Updates a row from a multipart body: a file part replaces the file, an empty field removes it, and a property
     * the body leaves out keeps its file. A file replaced or removed is deleted by the repository.
     * @param repo - The repository of the entity.
     * @param id - The id of the row.
     * @param properties - The file properties of the entity kept in a file store.
     * @param form - The body.
     * @returns The row.
     * @throws A ValidationError for an empty field in place of a file the entity requires.
     */
    static async updateById<T extends BaseEntity, CreateData extends DeepPartial<T>, UpdateData extends DeepPartial<T>>(
        repo: Repository<T, CreateData, UpdateData>,
        id: T['id'],
        properties: StoredFileProperty[],
        form: FormData<UpdateData>
    ): Promise<T> {
        try {
            const given: StoredFileProperty[] = properties.filter(p => Object.hasOwn(form.value, p.key));
            this.validateRequiredFilesKept(form.value, given);
            return await this.runInTransaction(repo, async ({ files, row }) => {
                // a row that is not there is refused before any of its files is stored
                await repo.findById(id, { transaction: row });
                const stored: StoredFileIds = await this.storeFiles(form.value, given, files);
                // the files it replaces or removes are deleted by the repository, once the write is committed
                return await repo.updateById(id, { ...form.value, ...stored }, { transaction: row });
            });
        }
        finally {
            await form.cleanup();
        }
    }

    /**
     * Resolves the download of a file of a row.
     * @param row - The row, as the controller reads it.
     * @param properties - The file properties of the entity kept in a file store.
     * @param file - The property, followed by the index for an item of an array, such as `attachments.2`.
     * @returns The bytes of the file, as a download under its name.
     * @throws A NotFoundError when the row holds no such file.
     */
    static async resolveDownload(row: BaseEntity, properties: StoredFileProperty[], file: string): Promise<FileResponse> {
        const fileId: string | undefined = this.findFileId(row, properties, file);
        const record: FileRecord | undefined = fileId == undefined ? undefined : await this.fileService.findFile(fileId);
        if (record == undefined) {
            throw new NotFoundError($ts`The row has no file "${file}".`);
        }
        // a file of the archive falls back to its copies when its bytes do not match
        const stream: Readable = ArchiveUtilities.isArchivedRow(row)
            ? await inject(ZIBRI_DI_TOKENS.ARCHIVE_SERVICE).readFile(row, record.id)
            : await this.fileService.readStream(record.id);
        const extension: FileExtension | undefined = MimeTypeUtilities.resolveFileExtension(record.mimeType);
        return FileResponse.fromStream({
            stream,
            filename: hasExtension(record.name) ? record.name : `${record.name}${extension ?? '.bin'}`,
            mimeType: record.mimeType,
            size: record.size,
            // a file a user uploaded stays a download: shown, an html file would be a page of the application's origin
            disposition: 'attachment'
        });
    }

    private static findFileId(row: BaseEntity, properties: StoredFileProperty[], file: string): string | undefined {
        const [key, index, ...rest] = file.split('.');
        const property: StoredFileProperty | undefined = properties.find(p => p.key === key);
        if (property == undefined || rest.length || property.isArray !== (index != undefined)) {
            return undefined;
        }
        const held: unknown = Reflect.get(row, property.key);
        const items: unknown[] = Array.isArray(held) ? held : [];
        const id: unknown = index == undefined ? held : /^\d+$/.test(index) ? items[Number(index)] : undefined;
        return typeof id === 'string' ? id : undefined;
    }

    /**
     * Stores the files a body carries for the given properties.
     * @param value - The body.
     * @param properties - The file properties of the entity kept in a file store that the body gives.
     * @param transaction - The transaction the row is written in.
     * @returns The ids to write into the row, by property: null and an empty list for an empty field.
     */
    private static async storeFiles(
        value: object,
        properties: StoredFileProperty[],
        transaction: RepositoryTransaction
    ): Promise<StoredFileIds> {
        const res: StoredFileIds = {};
        for (const property of properties) {
            const given: unknown = Reflect.get(value, property.key);
            if (given === undefined) {
                continue;
            }
            const items: unknown[] = Array.isArray(given) ? given : [given];
            const files: File[] = items.filter(f => f instanceof File);
            const ids: string[] = [];
            // one after the other, as the rows of one transaction are written over one connection
            for (const file of files) {
                ids.push((await this.fileService.store(
                    {
                        store: FilePropertyUtilities.resolveStoreName(property.file),
                        name: file.originalname,
                        mimeType: file.mimetype,
                        data: FsUtilities.createReadStream(file.path)
                    },
                    transaction
                )).id);
            }
            res[property.key] = property.isArray ? ids : ids[0] ?? null;
        }
        return res;
    }

    /**
     * Validates that a body removes no file the entity requires.
     * @param value - The body.
     * @param given - The file properties of the entity kept in a file store that the body gives.
     * @throws A ValidationError naming each required file it removes.
     */
    private static validateRequiredFilesKept(value: object, given: StoredFileProperty[]): void {
        const removed: StoredFileProperty[] = given
            .filter(p => !p.isArray && p.property.required === true && Reflect.get(value, p.key) == undefined);
        if (removed.length) {
            throw new ValidationError('body', undefined, removed.map(p => new IsRequiredValidationProblem(p.key)));
        }
    }

    /**
     * Runs the write of a row and its files in one transaction.
     * @param repo - The repository of the entity.
     * @param work - The write, given the transaction once as the file service takes it, once as the repository does.
     * @returns What the write answers, once the transaction is committed.
     */
    private static async runInTransaction<T extends BaseEntity, CreateData extends DeepPartial<T>, UpdateData extends DeepPartial<T>, R>(
        repo: Repository<T, CreateData, UpdateData>,
        work: (transaction: WriteTransactions<T>) => Promise<R>
    ): Promise<R> {
        // spanning, as the rows of the files may be kept in another data source than the entity, which costs nothing
        // extra when they are not. A row of a chain cannot be restored, so a chained entity takes one of its data source
        const transaction: RepositoryTransaction = ChainUtilities.isChained(repo.entityClass)
            ? await repo.dataSource.startTransaction()
            : new SpanningTransaction();
        return await TransactionUtilities.runAndCommit(transaction, async started => await work({
            files: started,
            row: TransactionUtilities.resolveRepositoryTransaction(started, repo.entityClass)
        }));
    }
}