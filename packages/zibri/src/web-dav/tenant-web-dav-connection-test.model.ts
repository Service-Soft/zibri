import { type TenantWebDavConnection } from './tenant-web-dav-connection.model';

/**
 * What a connection of a tenant is tested with before it is stored: its kind, its url, and who logs in.
 */
export type TenantWebDavConnectionTest = Pick<TenantWebDavConnection, 'kind' | 'url' | 'username' | 'password'>;