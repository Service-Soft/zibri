import { beforeAll, describe, expect, it } from '@jest/globals';

import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { initDiContainer } from '../di/init-di-container.function';
import { inject } from '../di/inject.function';
import { GlobalRegistry } from '../global/global-registry';
import { HttpMethod } from '../http/http-method.enum';
import { HeaderParamMetadataInput } from '../routing/decorators/param.decorator';
import { HttpClientResponseBodyInput } from './http-client-response.model';
import { HttpClientResult } from './http-client-result.type';
import {
    HttpClientHeaderValue,
    HttpClientInterface,
    HttpClientRequestBody,
    HttpClientRequestBodyMimeType,
    HttpOptionsInput
} from './http-client.interface';

/**
 * A http client as an application of 3.2 implemented it, whose `request` takes the methods of HTTP alone, handing
 * every request to the client of zibri. The typecheck checks that it still implements the interface.
 */
class HttpClientOf32 implements HttpClientInterface {
    readonly methods: HttpMethod[] = [];
    readonly fetchForLibrary: HttpClientInterface['fetchForLibrary'];
    readonly post: HttpClientInterface['post'];
    readonly get: HttpClientInterface['get'];
    readonly put: HttpClientInterface['put'];
    readonly patch: HttpClientInterface['patch'];
    readonly head: HttpClientInterface['head'];
    readonly options: HttpClientInterface['options'];
    readonly delete: HttpClientInterface['delete'];

    constructor(private readonly inner: HttpClientInterface) {
        this.fetchForLibrary = inner.fetchForLibrary.bind(inner);
        this.post = inner.post.bind(inner);
        this.get = inner.get.bind(inner);
        this.put = inner.put.bind(inner);
        this.patch = inner.patch.bind(inner);
        this.head = inner.head.bind(inner);
        this.options = inner.options.bind(inner);
        this.delete = inner.delete.bind(inner);
    }

    async request<
        T extends object,
        QueryParamsObject extends Record<string, unknown>,
        HeaderParamsObject extends Record<string, HttpClientHeaderValue>,
        ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput>,
        IsArray extends boolean,
        ResponseBody extends HttpClientResponseBodyInput<T, IsArray> = never,
        RequestBodyType extends HttpClientRequestBodyMimeType = HttpClientRequestBodyMimeType
    >(
        method: HttpMethod,
        url: string,
        requestBody: NoInfer<HttpClientRequestBody<RequestBodyType>>,
        options: HttpOptionsInput<
            T,
            QueryParamsObject,
            HeaderParamsObject,
            ResponseHeaderMetaInputObject,
            IsArray,
            ResponseBody,
            RequestBodyType
        > | undefined
    ): Promise<HttpClientResult<T, ResponseHeaderMetaInputObject, ResponseBody, IsArray>> {
        this.methods.push(method);
        return await this.inner.request(method, url, requestBody, options);
    }
}

beforeAll(() => {
    initDiContainer();
    // the error of a refused request carries a translated message, which an application that is not created refuses
    GlobalRegistry.markAppAsCreated();
});

describe('a http client of 3.2, whose request takes an HttpMethod', () => {
    it('sends its requests through its own request', async () => {
        const client: HttpClientOf32 = new HttpClientOf32(inject(ZIBRI_DI_TOKENS.HTTP_CLIENT));

        // refused before anything is sent, as fetch cannot send it
        await expect(client.request(HttpMethod.TRACE, 'http://localhost/trace', undefined, undefined)).rejects.toThrow('TRACE');
        expect(client.methods).toEqual([HttpMethod.TRACE]);
    });
});
