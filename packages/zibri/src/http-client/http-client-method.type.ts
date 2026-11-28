import { HttpMethod } from '../http/http-method.enum';
import { WebDavMethod } from './web-dav-method.enum';

/**
 * A method the http client sends a request with: one of HTTP itself, or one of WebDAV.
 */
export type HttpClientMethod = HttpMethod | WebDavMethod;