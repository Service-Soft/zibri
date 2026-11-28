/**
 * Where a folder of a WebDAV server is, and who logs in to it.
 */
export type WebDavConnection = {
    /**
     * The url of the folder every path is relative to, such as
     * `https://cloud.example.com/remote.php/dav/files/ada/` for the files of Ada on Nextcloud.
     */
    url: string,
    /**
     * The name of the user logging in.
     */
    username: string,
    /**
     * The password of the user. For Nextcloud an app password, which can be revoked on its own and works with two
     * factor authentication turned on.
     */
    password: string
};