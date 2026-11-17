import { AnyTenantBackupTransportKind } from './tenant-backup-transport-kind.interface';
import { TenantBackupTransportOptions } from './tenant-backup-transport-options.model';
import { TenantBackupTransport } from './tenant-backup-transport.model';
import { TenantTransportNetwork } from './tenant-transport-network.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { JsonUtilities } from '../../utilities/json.utilities';
import { NetworkAddressUtilities } from '../../utilities/network-address.utilities';
import { BackupTransportSessionInterface } from '../transports/backup-transport-session.interface';
import { BackupTransportInterface, BackupTransportSupporting } from '../transports/backup-transport.interface';

/**
 * The prefix of the name of every tenant's transport, which the id of its row follows.
 */
export const TENANT_TRANSPORT_NAME_PREFIX: string = 'tenant-transport:';

/**
 * A transport a tenant configured, of `v2`, built by its kind for every session, reaching only the hosts the
 * options let tenants reach.
 *
 * Every session checks the hosts again, since a name can lead elsewhere by the time of the next one.
 */
export class TenantRowBackupTransport implements BackupTransportInterface<'v2'> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly versions: readonly 'v2'[] = ['v2'];

    /**
     * Creates the transport of a tenant's row.
     * @param transport - The tenant's transport, its secret decrypted.
     * @param options - What tenants may configure and reach.
     */
    constructor(
        private readonly transport: TenantBackupTransport,
        private readonly options: TenantBackupTransportOptions
    ) {
        this.name = `${TENANT_TRANSPORT_NAME_PREFIX}${transport.id}`;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async openSession(): Promise<BackupTransportSessionInterface> {
        const kind: AnyTenantBackupTransportKind | undefined = this.options.kinds.find(k => k.name === this.transport.kind);
        if (kind == undefined) {
            throw new InternalError(
                `The transport "${this.transport.name}" is a "${this.transport.kind}", `
                + 'which is none of the kinds BACKUP_TENANT_TRANSPORT_OPTIONS lists.'
            );
        }
        const network: TenantTransportNetwork = {
            resolveAddress: async host => await this.resolveAddress(host),
            allowPrivateNetworks: this.options.allowPrivateNetworks
        };
        const created: BackupTransportSupporting<'v2'> = await kind.createTransport(
            this.name,
            this.transport.settings,
            this.resolveSecret(),
            network
        );
        return await created.openSession();
    }

    /**
     * Resolves where a host of the transport is reached: at a public address, or as it is where private
     * networks are allowed.
     * @param host - The host.
     * @returns The address, or the host itself where private networks are allowed.
     */
    private async resolveAddress(host: string): Promise<string> {
        if (this.options.allowPrivateNetworks) {
            NetworkAddressUtilities.validateAllowedHost(host, this.options.allowedHosts);
            return host;
        }
        return await NetworkAddressUtilities.resolvePublicAddress(host, this.options.allowedHosts);
    }

    private resolveSecret(): Record<string, unknown> {
        const parsed: unknown = JsonUtilities.parse(this.transport.secret);
        if (typeof parsed === 'object' && parsed != undefined && !Array.isArray(parsed)) {
            return Object.fromEntries(Object.entries(parsed));
        }
        throw new InternalError(`The secret of the transport "${this.transport.name}" is not an object.`);
    }
}