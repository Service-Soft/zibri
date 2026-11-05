import { HttpClientResponseBodyInput, HttpClientResponseForBody } from './http-client-response.model';
import { HeaderParamMetadataInput } from '../routing/decorators/param.decorator';
import { HeaderMetaInputObjectToMetaObject, HeaderMetaObjectToParamsObject } from '../routing/route-configuration.model';

/**
 * What a request of the http client resolves to: the response for the `responseBody` it declares,
 * with the `responseHeaders` it declares parsed.
 */
export type HttpClientResult<
    T extends object,
    ResponseHeaderMetaInputObject extends Record<string, HeaderParamMetadataInput>,
    ResponseBody extends HttpClientResponseBodyInput<T, IsArray>,
    IsArray extends boolean
> = HttpClientResponseForBody<
    T,
    HeaderMetaObjectToParamsObject<HeaderMetaInputObjectToMetaObject<ResponseHeaderMetaInputObject>>,
    ResponseBody,
    IsArray
>;