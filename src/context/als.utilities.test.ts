import { describe, expect, it } from '@jest/globals';

import { AlsUtilities } from './als.utilities';
import { CacheContext } from './cache/cache.context';
import { HttpRequestContext } from './request/http-request.context';
import { WebsocketRequestContext } from './request/websocket-request.context';
import { CacheOperation } from '../caching/cache/cache-operation.enum';
import { HttpRequest } from '../http/http-request.model';
import { HttpResponse } from '../http/http-response.model';
import { WebsocketRequest } from '../websocket/models/websocket-request.model';

function createHttpContext(): HttpRequestContext {
    return new HttpRequestContext({} as HttpRequest, {} as HttpResponse, undefined, undefined);
}

function createWebsocketContext(): WebsocketRequestContext {
    return new WebsocketRequestContext({} as WebsocketRequest, undefined, undefined, undefined);
}

function createCacheContext(cache: string): CacheContext {
    return { cache, operation: CacheOperation.WRAP };
}

describe('AlsUtilities', () => {
    describe('runWithHttpRequestContext / getCurrentRequestContext', () => {
        it('exposes the context only for the duration of the callback', () => {
            expect(AlsUtilities.getCurrentRequestContext()).toBeUndefined();

            const context: HttpRequestContext = createHttpContext();
            const seenInsideCallback: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.runWithHttpRequestContext(
                context,
                () => AlsUtilities.getCurrentRequestContext()
            );

            expect(seenInsideCallback).toBe(context);
            expect(AlsUtilities.getCurrentRequestContext()).toBeUndefined();
        });

        it('propagates the context into a nested async callback', async () => {
            const context: HttpRequestContext = createHttpContext();

            const seen: HttpRequestContext | WebsocketRequestContext | undefined = await AlsUtilities.runWithHttpRequestContext(
                context,
                async () => {
                    await Promise.resolve();
                    return AlsUtilities.getCurrentRequestContext();
                }
            );

            expect(seen).toBe(context);
        });
    });

    describe('runWithWebsocketRequestContext / getCurrentRequestContext', () => {
        it('exposes the websocket context only for the duration of the callback', () => {
            const context: WebsocketRequestContext = createWebsocketContext();

            const seenInsideCallback: HttpRequestContext | WebsocketRequestContext | undefined
                = AlsUtilities.runWithWebsocketRequestContext(context, () => AlsUtilities.getCurrentRequestContext());

            expect(seenInsideCallback).toBe(context);
            expect(AlsUtilities.getCurrentRequestContext()).toBeUndefined();
        });
    });

    describe('runWithCacheContext', () => {
        it('returns undefined outside of any cache context', () => {
            expect(AlsUtilities.getCurrentCacheContext()).toBeUndefined();
        });

        it('makes a single cache context available as a one-element array', () => {
            const seen: CacheContext[] | undefined = AlsUtilities.runWithCacheContext(
                createCacheContext('outer'),
                () => AlsUtilities.getCurrentCacheContext()
            );

            expect(seen?.map(c => c.cache)).toEqual(['outer']);
        });

        it('accumulates nested cache contexts instead of replacing the outer one', () => {
            const seen: CacheContext[] | undefined = AlsUtilities.runWithCacheContext(createCacheContext('outer'), () => {
                return AlsUtilities.runWithCacheContext(createCacheContext('inner'), () => AlsUtilities.getCurrentCacheContext());
            });

            expect(seen?.map(c => c.cache)).toEqual(['outer', 'inner']);
        });

        it('does not mutate the outer scope\'s array when a nested context is entered', () => {
            let outerArrayDuringNestedCall: CacheContext[] | undefined;

            const outerSeenAfterNested: CacheContext[] | undefined = AlsUtilities.runWithCacheContext(createCacheContext('outer'), () => {
                const outerArrayRef: CacheContext[] | undefined = AlsUtilities.getCurrentCacheContext();

                AlsUtilities.runWithCacheContext(createCacheContext('inner'), () => {
                    outerArrayDuringNestedCall = outerArrayRef;
                });

                return AlsUtilities.getCurrentCacheContext();
            });

            expect(outerArrayDuringNestedCall?.map(c => c.cache)).toEqual(['outer']);
            expect(outerSeenAfterNested?.map(c => c.cache)).toEqual(['outer']);
        });
    });
});