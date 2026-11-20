import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { DataSourceInterface, IsolationLevel } from '../data-source/data-sources/data-source.interface';
import { Where } from '../data-source/models/where/where-filter.model';
import { Repository } from '../data-source/repository/repository';
import { TenantUtilities } from '../data-source/tenancy/tenant.utilities';
import { Transaction } from '../data-source/transaction/transaction.model';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { EntityMetadata } from '../entity/decorators/entity.decorator';
import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { isRelationMetadata } from '../entity/models/is-relation-metadata.function';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { TarEntry, TarUtilities } from '../utilities/tar.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { BackupEncryptionUtilities } from './backup-encryption.utilities';
import { TenantExportFormat } from './tenant-export-format.type';
import { TenantRowsBackupResource } from './tenant-rows.backup-resource';

/**
 * The shape of an export: its manifest, and the files it lists.
 */
const TENANT_EXPORT_FORMAT_VERSION: number = 1;

/**
 * The file of an export that says what the others hold.
 */
const MANIFEST_NAME: string = 'manifest.json';

/**
 * How a cell starts that a spreadsheet reads as a formula.
 */
const FORMULA_START: RegExp = /^[=+\-@\t\r]/;

/**
 * A number, which a spreadsheet reads as one and runs nothing of.
 */
const PLAIN_NUMBER: RegExp = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * One file of an export, staged on this instance's disk until it is packed.
 */
type StagedExportFile = {
    /**
     * The data source the rows were read from, which names the folder of the file.
     */
    dataSource: string,
    /**
     * The table of the entity the file holds the rows of.
     */
    entity: string,
    /**
     * The path of the file in the archive.
     */
    name: string,
    /**
     * Where the file is staged.
     */
    path: FsPath,
    /**
     * How many bytes it holds unencrypted, which is what the archive holds of it.
     */
    size: number,
    /**
     * How many rows the file holds.
     */
    rows: number,
    /**
     * The key the file is staged under.
     */
    key: Buffer,
    /**
     * The initialization vector the file is staged under.
     */
    iv: Buffer
};

/**
 * A file an export lists in its manifest.
 */
type TenantExportManifestFile = {
    /**
     * The data source the rows were read from.
     */
    dataSource: string,
    /**
     * The table of the entity the file holds the rows of.
     */
    entity: string,
    /**
     * The path of the file in the archive.
     */
    file: string,
    /**
     * How many rows the file holds.
     */
    rows: number
};

/**
 * What an export says of itself, as its manifest.
 */
type TenantExportManifest = {
    /**
     * The shape of the export.
     */
    formatVersion: number,
    /**
     * The tenant whose rows the export holds.
     */
    tenantId: string,
    /**
     * How the rows are written.
     */
    format: TenantExportFormat,
    /**
     * When the export was written, as an ISO 8601 string.
     */
    exportedAt: string,
    /**
     * The files the export holds besides the manifest.
     */
    files: TenantExportManifestFile[]
};

/**
 * What a property of a row is written as in an export.
 */
type ExportedColumn = {
    /**
     * The name of the property.
     */
    key: string,
    /**
     * The metadata of the property.
     */
    property: PropertyMetadata
};

/**
 * Writes the export of a tenant: its rows as an application answers them, in a tar archive with a file per
 * entity and a manifest.
 */
export abstract class TenantExportUtilities {
    /**
     * Writes the export of a tenant.
     * @param dataSources - The data sources whose rows of the tenant it holds.
     * @param tenantId - The tenant.
     * @param format - How the rows are written.
     * @param stagingFolder - Where each file is staged, encrypted, until it is packed.
     * @yields The archive.
     */
    static async* resolveArchive(
        dataSources: DataSourceInterface[],
        tenantId: string,
        format: TenantExportFormat,
        stagingFolder: FsPath
    ): AsyncGenerator<Buffer> {
        const staged: StagedExportFile[] = [];
        // each data source as of one moment: read one entity after another without it, a row written meanwhile
        // could be in the export while a row it points at is not. Only read, so held as long as reading takes
        // and no longer: ended once every entity is staged, before the archive goes out at whatever pace its
        // reader takes, so that a stalled download holds no moment of a data source open
        const transactions: Map<DataSourceInterface, Transaction> = new Map();
        try {
            for (const dataSource of dataSources) {
                transactions.set(
                    dataSource,
                    await dataSource.startTransaction({ isolationLevel: IsolationLevel.REPEATABLE_READ, idleTimeoutInMs: 0 })
                );
            }
            await FsUtilities.mkdir(stagingFolder);
            for (const dataSource of dataSources) {
                // a folder per data source: an entity declared in several of them holds rows of its own in each,
                // and two entities of different data sources can share a table name
                const dataSourceName: string = dataSource.constructor.name;
                for (const entityClass of dataSource.entities) {
                    const metadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entityClass);
                    // the rows of a tenant; those belonging to the running instances, such as leases, are no data.
                    // An entity a data source lists twice is read once
                    const where: Where<BaseEntity> | undefined = metadata == undefined || metadata.backedUp === false
                        || staged.some(s => s.dataSource === dataSourceName && s.entity === metadata.tableName)
                        ? undefined
                        : TenantUtilities.resolveRowsOf(entityClass, metadata, tenantId);
                    if (metadata != undefined && where != undefined) {
                        staged.push(await this.stageEntity(
                            dataSource,
                            entityClass,
                            metadata,
                            where,
                            tenantId,
                            format,
                            stagingFolder,
                            transactions.get(dataSource)
                        ));
                    }
                }
            }
            const manifest: TenantExportManifest = {
                formatVersion: TENANT_EXPORT_FORMAT_VERSION,
                tenantId,
                format,
                exportedAt: new Date().toISOString(),
                files: staged.map(s => ({ dataSource: s.dataSource, entity: s.entity, file: s.name, rows: s.rows }))
            };
            // taken out of the map first, so that the finally below rolls back none of them a second time
            const read: Transaction[] = [...transactions.values()];
            transactions.clear();
            await Promise.all(read.map(async t => await t.rollback()));
            yield* TarUtilities.pack(this.resolveEntries(Buffer.from(JsonUtilities.stringify(manifest, undefined, 4)), staged));
        }
        finally {
            await Promise.all([...transactions.values()].map(async t => await t.rollback()));
            await Promise.all(staged.map(async s => await FsUtilities.rm(s.path)));
        }
    }

    // async although nothing in it is awaited: TarUtilities.pack takes an async iterable
    // eslint-disable-next-line typescript/require-await
    private static async* resolveEntries(manifest: Buffer, staged: StagedExportFile[]): AsyncGenerator<TarEntry> {
        const modifiedAt: Date = new Date();
        yield { name: MANIFEST_NAME, size: manifest.length, modifiedAt, content: Readable.from([manifest]) };
        for (const file of staged) {
            yield {
                name: file.name,
                size: file.size,
                modifiedAt,
                content: BackupEncryptionUtilities.decryptStaged(FsUtilities.createReadStream(file.path), file.key, file.iv)
            };
        }
    }

    /**
     * Writes the rows of one entity of the tenant to a file of their own, as a read of them answers them.
     * @param dataSource - The data source the rows are read from.
     * @param entityClass - The entity.
     * @param metadata - Its metadata.
     * @param where - The rows of the tenant.
     * @param tenantId - The tenant.
     * @param format - How the rows are written.
     * @param stagingFolder - Where the file is staged.
     * @param transaction - The transaction the data source is read in as of one moment, if it has one.
     * @returns The staged file.
     */
    private static async stageEntity(
        dataSource: DataSourceInterface,
        entityClass: Newable<BaseEntity>,
        metadata: EntityMetadata,
        where: Where<BaseEntity>,
        tenantId: string,
        format: TenantExportFormat,
        stagingFolder: FsPath,
        transaction: Transaction | undefined
    ): Promise<StagedExportFile> {
        const file: StagedExportFile = {
            dataSource: dataSource.constructor.name,
            entity: metadata.tableName,
            name: `${dataSource.constructor.name}/${metadata.tableName}.${format === 'csv' ? 'csv' : 'jsonl'}`,
            path: FsUtilities.getPath(stagingFolder, `tenant-export-${UUIDUtilities.generate()}`),
            size: 0,
            rows: 0,
            // the rows decrypted, so that this instance's disk holds them under a key only this export holds
            key: BackupEncryptionUtilities.generateKey(),
            iv: randomBytes(16)
        };
        // read through to the end inside the tenant, as a request of it reads its rows
        await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => await pipeline(
            Readable.from(BackupEncryptionUtilities.encryptStaged(
                this.resolveLines(dataSource, entityClass, where, format, file, transaction),
                file.key,
                file.iv
            )),
            FsUtilities.createWriteStream(file.path)
        ));
        return file;
    }

    /**
     * The lines of the rows of an entity, counted into the file they are written to.
     * @param dataSource - The data source the rows are read from.
     * @param entityClass - The entity.
     * @param where - The rows.
     * @param format - How they are written.
     * @param file - The file, whose size and rows are counted.
     * @param transaction - The transaction the data source is read in as of one moment, if it has one.
     * @yields The lines.
     */
    private static async* resolveLines(
        dataSource: DataSourceInterface,
        entityClass: Newable<BaseEntity>,
        where: Where<BaseEntity>,
        format: TenantExportFormat,
        file: StagedExportFile,
        transaction: Transaction | undefined
    ): AsyncGenerator<Buffer> {
        const columns: ExportedColumn[] = this.resolveColumns(entityClass);
        // of this data source by name: an entity declared in several data sources has a repository in each
        const repository: Repository<BaseEntity> = dataSource.getRepository(entityClass);
        if (format === 'csv') {
            yield this.count(file, `${columns.map(c => this.resolveCsvCell(c.key)).join(',')}\r\n`);
        }
        const relations: Record<string, boolean> = Object.fromEntries(
            columns.filter(c => isRelationMetadata(c.property)).map(c => [c.key, true])
        );
        for await (const row of repository.stream({ where, relations, transaction })) {
            file.rows++;
            const values: unknown[] = columns.map(c => this.resolveValue(c, Reflect.get(row, c.key)));
            yield this.count(file, format === 'csv'
                ? `${values.map(v => this.resolveCsvCell(v)).join(',')}\r\n`
                : `${JsonUtilities.stringify(Object.fromEntries(columns.map((c, i) => [c.key, values[i]])))}\n`);
        }
    }

    /**
     * The properties an export holds of an entity's rows: what an application answers of them, without
     * the excluded and hashed ones, and of its relations the ids of the related rows its join rows name.
     * @param entityClass - The entity.
     * @returns The properties, in the order they are declared.
     */
    private static resolveColumns(entityClass: Newable<BaseEntity>): ExportedColumn[] {
        return ObjectUtilities.entries(MetadataUtilities.getModelProperties(entityClass))
            .filter(([, property]) => {
                if (isRelationMetadata(property)) {
                    return TenantRowsBackupResource.writesJoinRows(property);
                }
                // excluded for some callers is excluded here, where there is no caller to ask
                const hashed: boolean = 'hash' in property && property.hash != undefined && property.hash !== false;
                return property.exclude === false && !hashed;
            })
            .map(([key, property]) => ({ key, property }));
    }

    private static resolveValue(column: ExportedColumn, value: unknown): unknown {
        if (isRelationMetadata(column.property)) {
            return Array.isArray(value)
                ? value.flatMap(
                    (related: unknown) => typeof related === 'object' && related != undefined && 'id' in related ? [related.id] : []
                )
                : [];
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        return Buffer.isBuffer(value) ? value.toString('base64') : value ?? null;
    }

    /**
     * A value as a cell of CSV: text as it is, quoted when it holds a comma, a quote or a line break, and
     * an object or a list as JSON. Text a spreadsheet would run as a formula starts with a `'`.
     * @param value - The value.
     * @returns The cell.
     */
    private static resolveCsvCell(value: unknown): string {
        if (value == undefined) {
            return '';
        }
        // a value that is no object is a string, a number, a boolean or a bigint, whose String is its text
        // eslint-disable-next-line typescript/no-base-to-string
        let text: string = typeof value === 'object' ? JsonUtilities.stringify(value) : String(value);
        // any user of the tenant can write such a value, and whoever opens the export in a spreadsheet runs it,
        // which can send the cells beside it away through a link. A number written as text runs nothing
        if (typeof value === 'string' && FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) {
            text = `'${text}`;
        }
        return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }

    private static count(file: StagedExportFile, text: string): Buffer {
        const bytes: Buffer = Buffer.from(text, 'utf8');
        file.size += bytes.length;
        return bytes;
    }
}