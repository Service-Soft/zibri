import { HttpMethod, KnownHeader } from 'zibri';

/**
 * What a test browser request is sent with.
 */
export type TestBrowserRequest = RequestInit & {
    /**
     * The origin of another site's page that sends the request, like a provider's page posting a form
     * to the application. The request then carries that `Origin`, `Sec-Fetch-Site: cross-site`, and
     * only the cookies a browser sends across sites: those with `SameSite=None`, and on a top level GET
     * those with `SameSite=Lax` as well.
     */
    crossSiteFrom?: string
};

/**
 * When a browser sends a cookie along with a request another site caused.
 */
type SameSite = 'strict' | 'lax' | 'none';

/**
 * A cookie a site has set.
 */
type StoredCookie = {
    /**
     * Its value.
     */
    value: string,
    /**
     * When it goes along with a request another site caused. `lax` when the site said nothing, as in
     * every current browser.
     */
    sameSite: SameSite
};

/**
 * Plays the browser against a started test server: keeps the cookies each site sets, sends them back
 * to that site, and follows no redirect on its own, so each hop of a flow can be looked at.
 */
export class TestBrowser {
    // by origin, then by name: a provider's sign-in page keeps a session in cookies of its own, which
    // a browser sends back to the provider and never to the application
    private readonly cookies: Map<string, Map<string, StoredCookie>> = new Map();

    constructor(
        /**
         * Where the server listens, as `StartedTestServer.start` answers it.
         */
        private readonly appUrl: string,
        /**
         * The application's `baseUrl`, when it differs from where the server listens, and which this
         * browser resolves to the server - the shape of a deployment behind a reverse proxy.
         */
        private readonly publicUrl: string | undefined
    ) {}

    /**
     * Opens a url, sending the cookies its site has set.
     * @param url - The url.
     * @param request - Anything else to send.
     * @returns The response.
     */
    async open(url: string, request: TestBrowserRequest = {}): Promise<Response> {
        const { crossSiteFrom, ...init } = request;
        const resolved: string = this.publicUrl != undefined && url.startsWith(this.publicUrl)
            ? `${this.appUrl}${url.slice(this.publicUrl.length)}`
            : url;
        const origin: string = new URL(resolved).origin;
        const jar: Map<string, StoredCookie> = this.cookies.get(origin) ?? new Map<string, StoredCookie>();
        this.cookies.set(origin, jar);
        const headers: Headers = new Headers(init.headers);
        const sent: [string, StoredCookie][] = [...jar.entries()]
            .filter(([, cookie]) => crossSiteFrom == undefined || this.goesAcrossSites(cookie, init.method));
        if (sent.length) {
            headers.set(KnownHeader.COOKIE, sent.map(([name, cookie]) => `${name}=${cookie.value}`).join('; '));
        }
        if (crossSiteFrom != undefined) {
            headers.set(KnownHeader.ORIGIN, crossSiteFrom);
            headers.set(KnownHeader.SEC_FETCH_SITE, 'cross-site');
        }
        const res: Response = await fetch(resolved, { ...init, headers, redirect: 'manual' });
        this.keepCookies(jar, res);
        return res;
    }

    /**
     * Opens a url and reads where it sends the browser.
     * @param url - The url.
     * @param request - Anything else to send.
     * @returns The location.
     * @throws When the url sends the browser nowhere.
     */
    async follow(url: string, request: TestBrowserRequest = {}): Promise<string> {
        const res: Response = await this.open(url, request);
        const location: string | null = res.headers.get(KnownHeader.LOCATION);
        if (location == undefined) {
            throw new Error(`${url} answered ${res.status} without a location: ${await res.text()}`);
        }
        return location;
    }

    private goesAcrossSites(cookie: StoredCookie, method: string | undefined): boolean {
        const isGet: boolean = method == undefined || method.toUpperCase() === HttpMethod.GET;
        return cookie.sameSite === 'none' || (cookie.sameSite === 'lax' && isGet);
    }

    private keepCookies(jar: Map<string, StoredCookie>, res: Response): void {
        for (const cookie of res.headers.getSetCookie()) {
            const [pair = ''] = cookie.split(';');
            const name: string = pair.slice(0, pair.indexOf('='));
            const value: string = pair.slice(pair.indexOf('=') + 1);
            // how a cookie is cleared: empty, or expired - express at the start of the epoch, others
            // with a max age of zero
            if (value === '' || /expires=thu, 01 jan 1970|max-age=0(?:;|$)/i.test(cookie)) {
                jar.delete(name);
                continue;
            }
            jar.set(name, { value, sameSite: this.findSameSite(cookie) ?? 'lax' });
        }
    }

    private findSameSite(cookie: string): SameSite | undefined {
        const attribute: string | undefined = /;\s*samesite=(strict|lax|none)/i.exec(cookie)?.[1]?.toLowerCase();
        return attribute === 'strict' || attribute === 'lax' || attribute === 'none' ? attribute : undefined;
    }
}