import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { $ts } from '../../localization/translate.function';
import { StorageUtilities } from '../../storage/storage.utilities';
import { TenantWebDavConnection } from '../../web-dav/tenant-web-dav-connection.model';
import { WebDavConnectionKind } from '../../web-dav/web-dav-connection-kind.enum';

/**
 * What the kinds of tenant transports reaching storage through a `TenantWebDavConnection` share.
 */
export abstract class TenantWebDavTransportUtilities {
    /**
     * Validates the folder a tenant keeps its backups in, below the url of the connection.
     * @param folder - The folder, `''` for the folder of the connection.
     * @throws {BadRequestError} When a segment is empty, `.` or `..`.
     */
    static validateFolder(folder: string): void {
        if (folder === '') {
            return;
        }
        try {
            StorageUtilities.resolveKeySegments('transport', folder);
        }
        catch (error) {
            throw new BadRequestError(
                // eslint-disable-next-line stylistic/max-len -- one template, since it is the key of its translation
                $ts`The folder of a transport needs to be segments separated by "/", none of them empty, "." or "..", or empty for the folder of the connection.`,
                { cause: error }
            );
        }
    }

    /**
     * Resolves the connection a tenant's transport is kept through, its password decrypted.
     * @param transportName - The name of the transport, for the errors.
     * @param tenantId - The tenant.
     * @param connectionId - The id of the connection.
     * @param kind - The kind the connection needs to be of.
     * @returns The connection.
     * @throws {InternalError} When the tenant has no connection of the id, or one of another kind.
     */
    static async resolveConnection(
        transportName: string,
        tenantId: string,
        connectionId: string,
        kind: WebDavConnectionKind
    ): Promise<TenantWebDavConnection> {
        // as the tenant, so that a connection of another tenant is none
        const connection: TenantWebDavConnection | undefined = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
            tenantId,
            async () => await inject(repositoryTokenFor(TenantWebDavConnection)).findOne({ where: { id: connectionId }, required: false })
        );
        if (connection == undefined) {
            throw new InternalError(
                `The transport "${transportName}" needs a WebDAV connection of the tenant,`
                + ` and the tenant has none of the id "${connectionId}".`
            );
        }
        // the transport of the other kind keeps the folder read-only and its trash bin empty, which a connection to
        // any other server cannot, and a Nextcloud through the plain transport would silently do neither
        if (connection.kind !== kind) {
            throw new InternalError(
                `The transport "${transportName}" needs a WebDAV connection of the kind ${kind},`
                + ` and "${connection.name}" is of the kind ${connection.kind}.`
            );
        }
        return connection;
    }
}