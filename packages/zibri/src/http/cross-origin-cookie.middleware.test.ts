import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { CorsOrigin } from './cors.middleware';
import { KnownHeader } from './known-header.enum';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Auth } from '../auth/decorators/auth.decorator';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { BaseEntity } from '../entity/base-entity.model';
import { AcceptCrossSitePosts } from '../routing/decorators/accept-cross-site-posts.decorator';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Param } from '../routing/decorators/param.decorator';
import { Post } from '../routing/decorators/post.decorator';
import { Newable } from '../types/newable.type';

const allowedOrigin: CorsOrigin = 'https://app.example.com';
const foreignOrigin: CorsOrigin = 'https://evil.example.com';
const cookie: string = 'sessionId=the-users';

@DataSource()
class CrossOriginCookieDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = defaultTestServerEntities;
}

/**
 * Public routes, because the requests these cases are about never reach a session check.
 */
@Controller('/cross-origin-cookie-test')
class CrossOriginCookieTestController {
    /**
     * Something that changes state, acting on whatever the cookie says.
     * @returns Anything at all - only the status is read.
     */
    @Post('/')
    @Auth.skip()
    act(): string {
        return 'acted';
    }

    /**
     * Something that changes nothing.
     * @returns Anything at all - only the status is read.
     */
    @Get('/')
    @Auth.skip()
    read(): string {
        return 'read';
    }
}

const providerOrigin: CorsOrigin = 'https://provider.example.com';

/**
 * Routes another site's page posts to on purpose, the way an identity provider answers a sign-in.
 */
@Controller('/cross-site-posts-test')
class CrossSitePostsTestController {
    @AcceptCrossSitePosts({ acceptedOrigins: [providerOrigin] })
    @Post('/callback')
    @Auth.skip()
    callback(): string {
        return 'taken';
    }

    @AcceptCrossSitePosts({ acceptedOrigins: params => params['tenant'] === 'acme' ? [providerOrigin] : [] })
    @Post('/:tenant/callback')
    @Auth.skip()
    tenantCallback(
        @Param.path('tenant')
        tenant: string
    ): string {
        return tenant;
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string = '';

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [CrossOriginCookieDataSource],
        controllers: [CrossOriginCookieTestController, CrossSitePostsTestController],
        security: { cors: { origins: [allowedOrigin], credentials: true } }
    });
    baseUrl = await server.start();
}, 30000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 15000);

/**
 * Sends a request to the test route.
 * @param method - The http method.
 * @param headers - The headers a browser, or something else, would send.
 * @returns The status it was answered with.
 */
async function resolveStatus(method: 'GET' | 'POST', headers: Record<string, string>): Promise<number> {
    const res: Response = await fetch(`${baseUrl}/cross-origin-cookie-test`, { method, headers });
    return res.status;
}

describe('crossOriginCookieMiddleware', () => {
    it('refuses a write a page on another site sent with cookies', async () => {
        expect(await resolveStatus('POST', {
            [KnownHeader.SEC_FETCH_SITE]: 'cross-site',
            [KnownHeader.ORIGIN]: foreignOrigin,
            [KnownHeader.COOKIE]: cookie
        })).toBe(403);
    });

    it('refuses a write a sibling subdomain sent with cookies', async () => {
        expect(await resolveStatus('POST', {
            [KnownHeader.SEC_FETCH_SITE]: 'same-site',
            [KnownHeader.ORIGIN]: 'https://user-content.example.com',
            [KnownHeader.COOKIE]: cookie
        })).toBe(403);
    });

    it('refuses by the origin header when a browser sends no fetch metadata', async () => {
        expect(await resolveStatus('POST', { [KnownHeader.ORIGIN]: foreignOrigin, [KnownHeader.COOKIE]: cookie })).toBe(403);
    });

    it('lets through an origin cors allows to send credentials', async () => {
        expect(await resolveStatus('POST', {
            [KnownHeader.SEC_FETCH_SITE]: 'cross-site',
            [KnownHeader.ORIGIN]: allowedOrigin,
            [KnownHeader.COOKIE]: cookie
        })).toBe(200);
    });

    it('lets through a write from its own origin', async () => {
        expect(await resolveStatus('POST', { [KnownHeader.SEC_FETCH_SITE]: 'same-origin', [KnownHeader.COOKIE]: cookie })).toBe(200);
        expect(await resolveStatus('POST', { [KnownHeader.ORIGIN]: baseUrl, [KnownHeader.COOKIE]: cookie })).toBe(200);
    });

    it('lets through a write from another site that carries no cookies', async () => {
        expect(await resolveStatus('POST', { [KnownHeader.SEC_FETCH_SITE]: 'cross-site', [KnownHeader.ORIGIN]: foreignOrigin })).toBe(200);
    });

    it('lets through a caller that is not a page', async () => {
        // a server or a command line tool names no origin and sends no fetch metadata
        expect(await resolveStatus('POST', { [KnownHeader.COOKIE]: cookie })).toBe(200);
    });

    it('lets through a read from another site with cookies', async () => {
        expect(await resolveStatus('GET', {
            [KnownHeader.SEC_FETCH_SITE]: 'cross-site',
            [KnownHeader.ORIGIN]: foreignOrigin,
            [KnownHeader.COOKIE]: cookie
        })).toBe(200);
    });
});

describe('crossOriginCookieMiddleware — a route accepting cross site posts', () => {
    /**
     * Posts to a route of the controller accepting them, the way another site's page does.
     * @param path - The route below the controller.
     * @param origin - The origin the page names, if any.
     * @returns The status it was answered with.
     */
    async function resolvePostStatus(path: string, origin: string | undefined): Promise<number> {
        const res: Response = await fetch(`${baseUrl}/cross-site-posts-test${path}`, {
            method: 'POST',
            headers: {
                [KnownHeader.SEC_FETCH_SITE]: 'cross-site',
                [KnownHeader.COOKIE]: cookie,
                ...origin == undefined ? {} : { [KnownHeader.ORIGIN]: origin }
            }
        });
        return res.status;
    }

    it('lets through a write with cookies from an origin the route accepts', async () => {
        expect(await resolvePostStatus('/callback', providerOrigin)).toBe(200);
    });

    it('refuses one from an origin the route does not accept', async () => {
        expect(await resolvePostStatus('/callback', foreignOrigin)).toBe(403);
    });

    it('refuses one that names no origin, or an opaque one', async () => {
        expect(await resolvePostStatus('/callback', undefined)).toBe(403);
        expect(await resolvePostStatus('/callback', 'null')).toBe(403);
    });

    it('asks the route which origins it accepts, with the parameters of its path', async () => {
        expect(await resolvePostStatus('/acme/callback', providerOrigin)).toBe(200);
        expect(await resolvePostStatus('/other/callback', providerOrigin)).toBe(403);
    });

    it('keeps refusing the same origin on every other route', async () => {
        expect(await resolveStatus('POST', {
            [KnownHeader.SEC_FETCH_SITE]: 'cross-site',
            [KnownHeader.ORIGIN]: providerOrigin,
            [KnownHeader.COOKIE]: cookie
        })).toBe(403);
    });
});