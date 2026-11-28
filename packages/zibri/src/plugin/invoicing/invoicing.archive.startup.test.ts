import { afterAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { FsFileStore } from '../../file/stores/fs.file-store';
import { Newable } from '../../types/newable.type';
import { FsUtilities } from '../../utilities/fs.utilities';
import {
    invoiceArchiveTestEntities,
    invoiceArchiveTestProviders,
    InvoiceDocumentsFileStore,
    invoiceDocumentsFolder
} from './invoicing.archive.cases';
import { ZibriInvoicingPlugin } from './invoicing.plugin';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from './invoicing.tokens';
import { InvoiceDocument } from './models/invoice-document.model';

// a file of its own, as each case starts an application that refuses to start. In memory, as nothing here depends on
// where the rows are stored

/**
 * Starts an application of the invoicing plugin, and stops it again once it started.
 * @param entities - The entities of its data source, besides those of a test server.
 * @param providers - Its providers, besides those of a test server.
 * @param fileStores - Its file stores.
 */
async function start(entities: Newable<BaseEntity>[], providers: DiProvider<unknown>[], fileStores: Newable<FsFileStore>[]): Promise<void> {
    const server: StartedTestServer = await startTestServer({
        fileStores,
        dataSources: [
            // orphaned once the application started on it is gone, as the next case declares one of its own
            createInMemoryDataSource({ entities: [...defaultTestServerEntities, ...entities], repositories: defaultTestServerRepositories, allowOrphan: true })
        ],
        plugins: [new ZibriInvoicingPlugin()],
        providers: [...defaultTestServerProviders, ...providers]
    });
    await server.shutdown();
}

afterAll(async () => {
    await FsUtilities.rm(invoiceDocumentsFolder);
}, TestTimeouts.inMemory.shutdown);

describe('archiving the documents of issued invoices', () => {
    it('refuses to start with the archive of the options and without InvoiceDocument', async () => {
        await expect(start(invoiceArchiveTestEntities.filter(e => e !== InvoiceDocument), invoiceArchiveTestProviders, [InvoiceDocumentsFileStore]))
            .rejects.toThrow('InvoiceDocument');
    }, TestTimeouts.inMemory.start);

    it('refuses to start with InvoiceDocument and without the archive of the options', async () => {
        const withoutArchive: DiProvider<unknown>[] = [
            ...invoiceArchiveTestProviders.slice(1),
            defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: {} })
        ];

        await expect(start(invoiceArchiveTestEntities, withoutArchive, [InvoiceDocumentsFileStore]))
            .rejects.toThrow('the file store "none, as the invoicing options name no archive"');
    }, TestTimeouts.inMemory.start);

    it('refuses to start with the archive of the options naming a store that is not registered', async () => {
        const elsewhere: DiProvider<unknown>[] = [
            ...invoiceArchiveTestProviders.slice(1),
            defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: { archive: { store: 'nowhere', locale: 'en-US', resolveConformance: () => undefined } } })
        ];

        await expect(start(invoiceArchiveTestEntities, elsewhere, [InvoiceDocumentsFileStore]))
            .rejects.toThrow('InvoiceDocument.pdf keeps its files in the file store "nowhere", named by zi.invoicing.document_file_store, which is not registered.');
    }, TestTimeouts.inMemory.start);

    it('starts with all of it, and without any of it', async () => {
        await start(invoiceArchiveTestEntities, invoiceArchiveTestProviders, [InvoiceDocumentsFileStore]);
        await start(invoiceArchiveTestEntities.filter(e => e !== InvoiceDocument), invoiceArchiveTestProviders.slice(1), []);
    }, TestTimeouts.inMemory.start);
});
