import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { findHeader } from '../../http/find-header.function';
import { KnownHeader } from '../../http/known-header.enum';
import { LOGIN_USER_AGENT_MAX_LENGTH, LoginDevice } from '../models/login-device.model';

/**
 * Resolves the client the current request comes from, for the login it starts or refreshes.
 * @returns The client. Nothing outside an http request.
 */
export function resolveLoginDevice(): LoginDevice {
    const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
    if (!(context instanceof HttpRequestContext)) {
        return { userAgent: undefined, ipAddress: undefined };
    }
    return {
        userAgent: findHeader(context.request.headers, KnownHeader.USER_AGENT)?.slice(0, LOGIN_USER_AGENT_MAX_LENGTH),
        ipAddress: context.request.ip ?? context.request.socket?.remoteAddress
    };
}