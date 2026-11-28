import { Readable } from 'node:stream';

import { TenantTransportNetwork } from '../../backup/tenant/tenant-transport-network.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { JsonUtilities } from '../../utilities/json.utilities';
import { NetworkAddressUtilities } from '../../utilities/network-address.utilities';
import { FileStoreEntry } from '../stores/file-store-entry.model';
import { FileStoreInterface } from '../stores/file-store.interface';
import { AnyTenantFileStoreKind } from './tenant-file-store-kind.interface';
import { TenantFileStoreOptions } from './tenant-file-store-options.model';
import { TenantFileStore } from './tenant-file-store.model';

/**
 * The prefix of the name of every tenant's file store, which the id of its row follows.
 */
export const TENANT_FILE_STORE_NAME_PREFIX: string = 'tenant-file-store:';

/**
 * A file store a tenant configured, built by its kind for every call, reaching only the hosts the options let tenants
 * reach.
 *
 * Every call checks the hosts again, since a name can lead elsewhere by the time of the next one.
 */
export class TenantRowFileStore implements FileStoreInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string;

    /**
     * Creates the file store of a tenant's row.
     * @param store - The tenant's file store, its secret decrypted.
     * @param options - What tenants may configure and reach.
     */
    constructor(
        private readonly store: TenantFileStore,
        private readonly options: TenantFileStoreOptions
    ) {
        this.name = `${TENANT_FILE_STORE_NAME_PREFIX}${store.id}`;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async put(key: string, data: Readable): Promise<void> {
        await (await this.resolveStore()).put(key, data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async get(key: string, maxBytes: number): Promise<Readable> {
        return await (await this.resolveStore()).get(key, maxBytes);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findEntry(key: string): Promise<FileStoreEntry | undefined> {
        return await (await this.resolveStore()).findEntry(key);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async* findKeys(prefix: string): AsyncIterable<string[]> {
        yield* (await this.resolveStore()).findKeys(prefix);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async delete(keys: string[]): Promise<void> {
        await (await this.resolveStore()).delete(keys);
    }

    /**
     * Resolves the store the kind builds for one call, its hosts checked.
     * @returns The store.
     */
    private async resolveStore(): Promise<FileStoreInterface> {
        const kind: AnyTenantFileStoreKind | undefined = this.options.kinds.find(k => k.name === this.store.kind);
        if (kind == undefined) {
            throw new InternalError(
                `The file store "${this.store.name}" is a "${this.store.kind}", `
                + 'which is none of the kinds FILE_TENANT_STORE_OPTIONS lists.'
            );
        }
        const network: TenantTransportNetwork = {
            resolveAddress: async host => await this.resolveAddress(host),
            allowPrivateNetworks: this.options.allowPrivateNetworks
        };
        return await kind.createStore(this.name, this.store.settings, this.resolveSecret(), network);
    }

    /**
     * Resolves where a host of the store is reached: at a public address, or as it is where private networks are
     * allowed.
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
        const parsed: unknown = JsonUtilities.parse(this.store.secret);
        if (typeof parsed === 'object' && parsed != undefined && !Array.isArray(parsed)) {
            return Object.fromEntries(Object.entries(parsed));
        }
        throw new InternalError(`The secret of the file store "${this.store.name}" is not an object.`);
    }
}