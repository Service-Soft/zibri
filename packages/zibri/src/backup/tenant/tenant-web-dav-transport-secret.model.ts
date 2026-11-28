/**
 * The secret of a tenant's transport through a WebDAV or Nextcloud connection: nothing, `{}`, as the password is the
 * connection's.
 */
// a class of no properties rather than the password a second time: the connection keeps it encrypted already, and a
// change of it there reaches every transport through it
export class TenantWebDavTransportSecret {}
