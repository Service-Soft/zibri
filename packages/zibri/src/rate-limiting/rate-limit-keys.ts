import { isIPv4, isIPv6 } from 'node:net';

import { type AuthServiceInterface } from '../auth/auth-service.interface';
import { type CurrentUser } from '../auth/decorators/current-user.decorator';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';

const GLOBAL_KEY: string = 'global';

/**
 * Ways to say what a rate limit counts per.
 *
 * Counting everything against one bucket is right for a shared resource - an outgoing mail server
 * has a capacity of its own - and wrong for anything a caller can trigger, where it means one
 * attacker exhausts the limit for every user at once. These read the current request, not the
 * arguments of the limited method.
 */
export abstract class RateLimitKeys {
    /**
     * Counts every call against one bucket, whoever makes it.
     *
     * For a limit that belongs to the resource, not to the caller: a mail server that accepts
     * so many messages an hour whoever asked for them. Worth saying out loud, because a shared
     * bucket is also what lets one caller spend everybody else's capacity.
     *
     * Also where the per caller keys land when there is no request to read a caller from, which is
     * the honest answer: work that nobody triggered cannot be counted against anybody.
     */
    static readonly GLOBAL: string = GLOBAL_KEY;

    /**
     * Counts per caller: the client address over http, the connection over a websocket. The default
     * when a limited method names no key.
     *
     * What unauthenticated routes want - a login, a password reset - where there is no account to
     * count against yet.
     *
     * Over http this is only ever as good as the address: an application behind a proxy has to set
     * `security.trustProxy`, or every request appears to come from that proxy and shares one bucket.
     * An IPv4 address is one caller. An IPv6 address is counted by its /64, the block one subscriber
     * holds, so every address of it is one caller.
     * A websocket is counted per connection, not per address - and reconnecting to escape a limit
     * costs a handshake every time.
     * @returns The key.
     */
    static resolveConnectionKey(): string {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!(context instanceof HttpRequestContext)) {
            return context?.connection ? `connection:${context.connection.id}` : GLOBAL_KEY;
        }
        return context.request.ip == undefined ? GLOBAL_KEY : RateLimitKeys.networkOf(context.request.ip);
    }

    /**
     * The network an address is counted as.
     *
     * An IPv6 address on its own would be one of 2^64 keys one machine holds, so it is its /64. An
     * IPv4 address arriving in its IPv6 form, as a dual stack socket presents it, is the IPv4
     * address: the /64 of that form is every IPv4 address there is.
     * @param ip - The address.
     * @returns The IPv4 address, or the /64 of an IPv6 address.
     */
    private static networkOf(ip: string): string {
        const unmapped: string = ip.replace(/^::ffff:/i, '');
        if (isIPv4(unmapped)) {
            return unmapped;
        }
        return !isIPv6(ip) ? ip : `${RateLimitKeys.leadingGroupsOf(ip, 4).join(':')}::/64`;
    }

    /**
     * The first groups of an IPv6 address, each written out in full.
     * @param ip - The address, compressed or not.
     * @param count - How many groups.
     * @returns The groups.
     */
    private static leadingGroupsOf(ip: string, count: number): string[] {
        // without a zone, which names the interface rather than the network
        const address: string = ip.split('%')[0] ?? ip;
        const [head = '', tail = ''] = address.split('::');
        const headGroups: string[] = head ? head.split(':') : [];
        const tailGroups: string[] = tail ? tail.split(':') : [];
        // a dotted quad at the end stands for two groups
        const groupsIn: (groups: string[]) => number = groups => groups.length + groups.filter(g => g.includes('.')).length;
        const zeros: string[] = Array.from({ length: 8 - groupsIn(headGroups) - groupsIn(tailGroups) }, () => '0');
        return [...headGroups, ...zeros, ...tailGroups].slice(0, count).map(group => group.padStart(4, '0'));
    }

    /**
     * Counts per logged in user, falling back to {@link RateLimitKeys.resolveConnectionKey} for
     * callers that are not logged in.
     *
     * The fallback is the point: without it every anonymous caller shares one key, so a route that
     * can be reached without logging in would have no per caller limit exactly where it needs one.
     * @returns The key.
     */
    static async resolveUserKey(): Promise<string> {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!context) {
            return GLOBAL_KEY;
        }
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const user: CurrentUser | undefined = await authService.resolveCurrentUser(context, authService.strategies, false);
        return user ? `user:${user.id}` : RateLimitKeys.resolveConnectionKey();
    }
}