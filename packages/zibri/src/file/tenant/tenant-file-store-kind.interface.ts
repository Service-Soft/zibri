import { TenantTransportNetwork } from '../../backup/tenant/tenant-transport-network.model';
import { Newable } from '../../types/newable.type';
import { FileStoreInterface } from '../stores/file-store.interface';

/**
 * A kind of storage a tenant may keep its files on, such as a bucket or an SFTP server: what a tenant configures of
 * it, the secret it logs in with, and the file store reaching it.
 *
 * The settings and the secret are checked against their models the way a request body is, and the secret is stored
 * encrypted. A kind connects to the hosts it reaches through the `TenantTransportNetwork` it is given, for every one
 * of them: what the application lets tenants reach is held only of the hosts a kind resolves there.
 */
export interface TenantFileStoreKindInterface<TSettings extends object, TSecret extends object> {
    /**
     * What the kind is called in a tenant's file store and in `FILE_TENANT_STORE_OPTIONS`, such as `'s3'`.
     */
    readonly name: string,
    /**
     * The class of what a tenant configures, checked as a request body is.
     */
    readonly settingsModel: Newable<TSettings>,
    /**
     * The class of the secret, checked as a request body is, and stored encrypted.
     */
    readonly secretModel: Newable<TSecret>,
    /**
     * Refuses settings and a secret beyond what their models say, such as a bucket over plain http.
     * @throws A BadRequestError saying what the settings need to be.
     */
    validateSettings?: (settings: TSettings, secret: TSecret, network: Pick<TenantTransportNetwork, 'allowPrivateNetworks'>) => void,
    /**
     * Builds the file store reaching the storage, for one call, which is made on it right after. Every host it
     * connects to is resolved through `network` first, and connected to at the address it answers, since a name can
     * lead elsewhere by the time of the next call.
     * @param name - The name of the store.
     * @param settings - What the tenant configured.
     * @param secret - The secret, decrypted.
     * @param network - What every host it connects to is checked by.
     * @returns The store.
     */
    createStore: (
        name: string,
        settings: TSettings,
        secret: TSecret,
        network: TenantTransportNetwork
    ) => Promise<FileStoreInterface>
}

/**
 * Any kind of storage a tenant may keep its files on.
 */
// any: the settings and the secret are taken and handed back, which only any is assignable to both ways
// eslint-disable-next-line typescript/no-explicit-any
export type AnyTenantFileStoreKind = TenantFileStoreKindInterface<any, any>;