import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { MigrationEntity } from '../data-source/migration/migration-entity.model';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { BaseTenantEntity } from '../entity/base-tenant-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupServiceInterface } from './backup-service.interface';

/**
 * An entity each of two data sources holds rows of its own of.
 */
@Entity({ allowDuplicate: true, tableName: 'split_note' })
class SplitNote extends BaseTenantEntity() {
    @Property.string()
    text!: string;
}

@DataSource()
class FirstExportedDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity, SplitNote];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

@DataSource()
class SecondExportedDataSource extends InMemoryDataSource {
    // MigrationEntity is duplicated across data sources on purpose, every one tracks its own migrations
    override readonly entities: Newable<BaseEntity>[] = [MigrationEntity, SplitNote];
    override readonly repositories: RepositoryClass[] = [];
}

const folder: FsPath = FsUtilities.getPath(testFileFolder, `tenant-export-${UUIDUtilities.generate()}`);

/**
 * A line of the manifest of an export.
 */
type ManifestFile = {
    dataSource: string,
    entity: string,
    file: string,
    rows: number
};

describe('BackupService - an export of a tenant of several data sources', () => {
    let server: StartedTestServer | undefined;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [FirstExportedDataSource, SecondExportedDataSource] });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        await FsUtilities.rm(folder);
    }, TestTimeouts.inMemory.shutdown);

    // the rows of an entity were read from the first data source holding it, and those of the others left out
    it('holds the rows of an entity of every data source holding it, each in the folder of its data source', async () => {
        const tenantId: string = UUIDUtilities.generate();
        const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        await tenants.runAs(tenantId, async () => {
            await inject(FirstExportedDataSource).getRepository(SplitNote)
                .create({ text: 'in the first' });
            await inject(SecondExportedDataSource).getRepository(SplitNote)
                .create({ text: 'in the second' });
        });
        const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
        assert(backupService.exportTenant, 'the backup service exports no tenant');
        await FsUtilities.mkdir(folder);
        const archive: FsPath = FsUtilities.getPath(folder, 'export.tar');

        await pipeline(await backupService.exportTenant(tenantId, 'json-lines'), FsUtilities.createWriteStream(archive));
        execFileSync('tar', ['-xf', archive, '-C', folder]);

        const manifest: { files: ManifestFile[] } = JsonUtilities.parse(await FsUtilities.readFile(FsUtilities.getPath(folder, 'manifest.json')));
        expect(manifest.files.filter(f => f.entity === 'split_note')).toStrictEqual([
            { dataSource: 'FirstExportedDataSource', entity: 'split_note', file: 'FirstExportedDataSource/split_note.jsonl', rows: 1 },
            { dataSource: 'SecondExportedDataSource', entity: 'split_note', file: 'SecondExportedDataSource/split_note.jsonl', rows: 1 }
        ]);
        const text: (file: string) => Promise<unknown> = async file => JsonUtilities.parse<{ text: string }>(
            (await FsUtilities.readFile(FsUtilities.getPath(folder, file))).trim()
        ).text;
        expect(await text('FirstExportedDataSource/split_note.jsonl')).toBe('in the first');
        expect(await text('SecondExportedDataSource/split_note.jsonl')).toBe('in the second');
    }, 30000);
});