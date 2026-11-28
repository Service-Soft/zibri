/**
 * A property of a resource on a WebDAV server beyond the ones every entry carries, by its namespace and its name,
 * such as `{ namespace: 'http://owncloud.org/ns', name: 'fileid' }` for the id Nextcloud keeps a file under.
 */
export type WebDavProperty = {
    /**
     * The namespace of the property, such as `http://owncloud.org/ns`.
     */
    namespace: string,
    /**
     * The name of the property within its namespace, such as `fileid`.
     */
    name: string
};
