import { type RepositoryTransaction } from '../data-source/transaction/repository-transaction.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { type BaseEntity } from '../entity/base-entity.model';
import { type Newable } from '../types/newable.type';
import { type TenantWebDavConnectionUsageCleanerInterface } from '../web-dav/tenant-web-dav-connection-usage-cleaner.interface';
import { type TenantWebDavConnection } from '../web-dav/tenant-web-dav-connection.model';
import { FileMirrorRequest } from './file-mirror-request.model';
import { FileMirrorShareLink } from './file-mirror-share-link.model';
import { MirroredFile } from './mirrored-file.model';

/**
 * Removes the mirrored files, the files queued to mirror and the share links of a connection of a tenant once the
 * connection is deleted. The files and the shares stay on the server. Nothing for an entity the application does not
 * declare.
 */
@Injectable({ register: 'onUse' })
export class FileMirrorUsageCleaner implements TenantWebDavConnectionUsageCleanerInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    async removeUsages(connection: TenantWebDavConnection, transaction: RepositoryTransaction): Promise<void> {
        // removed rather than kept: a connection is often deleted because its server is gone for good, where a file
        // queued is never written, and the rows would keep it forever
        const entities: Newable<BaseEntity & { connectionId: string }>[] = [MirroredFile, FileMirrorRequest, FileMirrorShareLink];
        const declared: Newable<BaseEntity>[] = inject(ZIBRI_DI_TOKENS.DATA_SOURCE_SERVICE).getDataSources()
            .flatMap(dataSource => dataSource.entities);
        // one after the other, as the writes of one transaction run over one connection
        for (const entity of entities.filter(candidate => declared.includes(candidate))) {
            await inject(repositoryTokenFor(entity)).deleteAll({ connectionId: connection.id }, { transaction });
        }
    }
}
