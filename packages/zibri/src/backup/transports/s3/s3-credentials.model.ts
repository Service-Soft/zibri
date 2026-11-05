/**
 * What requests to an S3 compatible service are signed with.
 */
export type S3Credentials = {
    /**
     * The access key.
     */
    readonly accessKeyId: string,
    /**
     * The secret of the access key.
     */
    readonly secretAccessKey: string,
    /**
     * The session token that comes with temporary credentials, sent with every request they sign.
     */
    readonly sessionToken?: string
};