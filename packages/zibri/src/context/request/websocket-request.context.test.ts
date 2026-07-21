import { describe, expect, it, jest } from '@jest/globals';

import { HttpRequestContext } from './http-request.context';
import { RequestContextToken } from './request-context-token.model';
import { WebsocketRequestContext } from './websocket-request.context';
import { WebsocketRequest } from '../../websocket/models/websocket-request.model';

function makeContext(): WebsocketRequestContext {
    return new WebsocketRequestContext(new WebsocketRequest(), undefined, undefined, undefined);
}

describe('WebsocketRequestContext', () => {
    it('has() returns false before the token has been resolved and true after', () => {
        const token: RequestContextToken<string> = new RequestContextToken('ws-ctx-has-test', () => 'value');
        const ctx: WebsocketRequestContext = makeContext();

        expect(ctx.has(token)).toBe(false);
        ctx.get(token);
        expect(ctx.has(token)).toBe(true);
    });

    it('get() memoizes the resolved value instead of calling fn again', () => {
        // eslint-disable-next-line typescript/typedef
        const fn = jest.fn(() => ({}));
        const token: RequestContextToken<object> = new RequestContextToken('ws-ctx-memo-test', fn);
        const ctx: WebsocketRequestContext = makeContext();

        const first: object = ctx.get(token);
        const second: object = ctx.get(token);

        expect(fn).toHaveBeenCalledTimes(1);
        expect(second).toBe(first);
    });

    it('get() passes the context itself to the token resolver', () => {
        const fn: (ctx: WebsocketRequestContext | HttpRequestContext) => string = jest.fn(() => 'x');
        const token: RequestContextToken<string> = new RequestContextToken('ws-ctx-passes-self', fn);
        const ctx: WebsocketRequestContext = makeContext();

        ctx.get(token);

        expect(fn).toHaveBeenCalledWith(ctx);
    });

    it('has() for a different token stays false while another token is cached', () => {
        const tokenA: RequestContextToken<string> = new RequestContextToken('ws-ctx-has-a', () => 'a');
        const tokenB: RequestContextToken<string> = new RequestContextToken('ws-ctx-has-b', () => 'b');
        const ctx: WebsocketRequestContext = makeContext();

        ctx.get(tokenA);

        expect(ctx.has(tokenA)).toBe(true);
        expect(ctx.has(tokenB)).toBe(false);
    });
});