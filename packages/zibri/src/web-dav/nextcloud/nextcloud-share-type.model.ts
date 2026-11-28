/**
 * Who a share of Nextcloud gives a file or a folder to: a `'user'`, a `'group'`, anyone with its `'link'`, or
 * `'other'` for the kinds Nextcloud has beyond these, such as a share by email or with another server.
 */
export type NextcloudShareType = 'user' | 'group' | 'link' | 'other';