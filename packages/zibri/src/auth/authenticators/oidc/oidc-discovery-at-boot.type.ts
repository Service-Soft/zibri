/**
 * What happens when an OpenID Connect provider's metadata cannot be read while the application starts.
 *
 * `required`: the application does not start.
 *
 * `whenReachable`: the application starts with a warning when the provider cannot be reached, and
 * reads the metadata on the first login. A provider that answers with something other than its
 * metadata, such as for a wrong `issuer`, stops the start all the same.
 */
export type OidcDiscoveryAtBoot = 'required' | 'whenReachable';