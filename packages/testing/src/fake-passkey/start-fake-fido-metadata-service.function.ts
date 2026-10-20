import { FakeFidoMetadataService } from './fake-fido-metadata-service.model.ts';

/**
 * Starts a FIDO Metadata Service in the test's own process, reached over plain http on the loopback
 * interface. It knows no model until it is told about one.
 * @returns The started service, which the test is responsible for stopping.
 */
export async function startFakeFidoMetadataService(): Promise<FakeFidoMetadataService> {
    const service: FakeFidoMetadataService = await FakeFidoMetadataService.create();
    await service.listen();
    return service;
}