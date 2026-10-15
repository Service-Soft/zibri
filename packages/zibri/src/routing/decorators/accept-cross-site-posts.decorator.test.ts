import { describe, expect, it } from '@jest/globals';

import { AcceptCrossSitePosts } from './accept-cross-site-posts.decorator';
import { Controller } from './controller.decorator';
import { Get } from './get.decorator';
import { Post } from './post.decorator';
import { startAndStopTestServerWithout } from '../../__testing__/test-server/start-and-stop-test-server-without.function';
import { Auth } from '../../auth/decorators/auth.decorator';

const providerOrigin: string = 'https://provider.example.com';

describe('AcceptCrossSitePosts', () => {
    it('refuses an empty list of origins, which would accept nothing', () => {
        expect(() => AcceptCrossSitePosts({ acceptedOrigins: [] })).toThrow(/at least one origin/);
    });

    it('refuses an entry that is not an origin', () => {
        expect(() => AcceptCrossSitePosts({ acceptedOrigins: ['https://provider.example.com/sign-in'] })).toThrow(/is not an origin/);
        expect(() => AcceptCrossSitePosts({ acceptedOrigins: ['*'] })).toThrow(/is not an origin/);
        expect(() => AcceptCrossSitePosts({ acceptedOrigins: ['null'] })).toThrow(/is not an origin/);
    });

    it('refuses to start on a route that changes nothing, where it has nothing to let through', async () => {
        @Auth.skip()
        @Controller('/accept-cross-site-reads', { allowOrphan: true })
        class ReadController {
            @AcceptCrossSitePosts({ acceptedOrigins: [providerOrigin] })
            @Get('/')
            read(): string {
                return 'read';
            }
        }

        await expect(startAndStopTestServerWithout([], { controllers: [ReadController] }))
            .rejects.toThrow(/AcceptCrossSitePosts.*GET \/accept-cross-site-reads/);
    }, 30000);

    it('refuses to start when the versions of one route do not all accept the same', async () => {
        // the check runs before the route, where nothing says yet which version a request is for
        @Auth.skip()
        @Controller('/accept-cross-site-versions', { versions: ['1.0.0'], allowOrphan: true })
        class AcceptingController {
            @AcceptCrossSitePosts({ acceptedOrigins: [providerOrigin] })
            @Post('/callback')
            callback(): string {
                return 'taken';
            }
        }

        @Auth.skip()
        @Controller('/accept-cross-site-versions', { versions: ['2.0.0'], allowOrphan: true })
        class RefusingController {
            @Post('/callback')
            callback(): string {
                return 'taken';
            }
        }

        await expect(startAndStopTestServerWithout([], { controllers: [AcceptingController, RefusingController] }))
            .rejects.toThrow(/POST \/accept-cross-site-versions\/callback/);
    }, 30000);
});