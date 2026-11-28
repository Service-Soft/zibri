/**
 * Reads the DNS records a site of the analytics is verified by.
 */
export interface AnalyticsDnsServiceInterface {
    /**
     * Resolves the TXT records of a domain, each with its strings joined.
     * @param domain - The domain, such as `example.com`.
     * @returns The values of its TXT records, none for a domain without any or that does not exist.
     */
    resolveTxtRecords: (domain: string) => Promise<string[]>
}