/**
 * A request to an S3 compatible service, as far as its signature covers it.
 */
export type S3SigningInput = {
    /**
     * The http method, in upper case.
     */
    method: string,
    /**
     * Where the request goes, with its path and query already encoded the way they are sent.
     */
    url: URL,
    /**
     * The headers besides `host` that the signature covers, and that are sent with it.
     */
    headers: Record<string, string>,
    /**
     * The sha256 of the body, in hex.
     */
    payloadHash: string,
    /**
     * The key the request is signed with.
     */
    accessKeyId: string,
    /**
     * The secret of that key.
     */
    secretAccessKey: string,
    /**
     * The region of the service.
     */
    region: string,
    /**
     * When the request is sent. The service refuses one signed too long before it arrives.
     */
    date: Date
};