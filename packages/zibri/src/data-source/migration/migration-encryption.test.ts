import { afterEach, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource, zibriFrameworkEntities } from 'zibri-testing';

import { Migration } from './migration.model';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { AesGcmEncryptionStrategy } from '../../auth/encryption/strategies/aes-gcm.encryption-strategy';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { SemVerVersion } from '../../versioning/sem-ver.utilities';
import { DataSource } from '../decorators/data-source.decorator';
import { Repository } from '../repository/repository';
import { Transaction } from '../transaction/transaction.model';

/**
 * Something a migration writes that has to be stored encrypted.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
class Vault extends BaseEntity {
    /**
     * What the vault keeps.
     */
    @Property.string({ encryption: true })
    secret!: string;
}

/**
 * Builds a data source holding the vault, with a migration that writes one.
 * @returns The data source's class.
 */
function vaultDataSource(): Newable<InMemoryDataSource> {
    /**
     * Writes a vault while the migrations run, before the application is initialized.
     */
    @Injectable()
    class SeedVaultMigration extends Migration {
        version: SemVerVersion = '0.0.1';

        constructor() {
            super(VaultDataSource);
        }

        override async up(transaction: Transaction): Promise<void> {
            await this.dataSource.getRepository(Vault).create({ secret: 'opened' }, { transaction });
        }

        // eslint-disable-next-line typescript/require-await
        override async down(): Promise<void> {
            throw new Error('Not implemented.');
        }
    }

    /**
     * The data source, with the migration.
     */
    @DataSource()
    class VaultDataSource extends InMemoryDataSource {
        override readonly entities: Newable<BaseEntity>[] = [...new Set([...zibriFrameworkEntities, ...defaultTestServerEntities, Vault])];
        override readonly migrations: Newable<Migration>[] = [SeedVaultMigration];
    }
    return VaultDataSource;
}

/**
 * Encrypts like the built in strategy, through something only an initialized application has.
 */
@Injectable()
class StartedOnlyStrategy extends AesGcmEncryptionStrategy {
    override readonly usableInMigrations: boolean = false;
}

describe('a migration writing an encrypted property', () => {
    let server: StartedTestServer | undefined;

    afterEach(async () => {
        await server?.shutdown();
        server = undefined;
    });

    it('encrypts it, although the application is not initialized yet', async () => {
        const dataSourceClass: Newable<InMemoryDataSource> = vaultDataSource();
        server = await startTestServer({ dataSources: [dataSourceClass] });

        const vaults: Repository<Vault> = inject(dataSourceClass).getRepository(Vault);
        const [stored]: Vault[] = await vaults.findAll({ autoDecrypt: false });
        const [read]: Vault[] = await vaults.findAll();
        // the strategies were loaded by the first encryption rather than by onAppInit, which had not run
        expect(stored?.secret).toMatch(/^aes-256-gcm\./);
        expect(read?.secret).toBe('opened');
    }, 15_000);

    it('refuses a strategy that is not usable in migrations, naming it and the migration', async () => {
        await expect(startTestServer({
            dataSources: [vaultDataSource()],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.ENCRYPTION_STRATEGIES, useValue: [StartedOnlyStrategy] })
            ]
        })).rejects.toThrow('"SeedVaultMigration" uses the encryption strategy "aes-256-gcm"');
    }, 15_000);
});