/**
 * The hosts of the loopback interface, which a request to never leaves the machine.
 */
const LOOPBACK_HOSTS: Set<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Answers questions about urls.
 */
export abstract class UrlUtilities {
    /**
     * Whether a url is reached on the loopback interface, where nobody can listen in.
     * @param url - The url.
     * @returns True for localhost, 127.0.0.1 and ::1.
     */
    static isLoopback(url: URL): boolean {
        return LOOPBACK_HOSTS.has(url.hostname);
    }

    /**
     * Whether a url is reached without anybody able to listen in: over https, or on the loopback
     * interface.
     * @param url - The url.
     * @returns True for an https url, or one on the loopback interface.
     */
    static isPrivate(url: URL): boolean {
        return url.protocol === 'https:' || UrlUtilities.isLoopback(url);
    }

    /**
     * The url without its query string.
     * @param url - The url, absolute or a path.
     * @returns Everything before the first `?`.
     */
    static withoutQuery(url: string): string {
        const queryStart: number = url.indexOf('?');
        return queryStart === -1 ? url : url.slice(0, queryStart);
    }
}