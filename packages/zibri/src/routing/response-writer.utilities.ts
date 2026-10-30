import { Readable } from 'node:stream';

import { NextFunction } from 'express';

import { DeclaredResponseUtilities } from './declared-response.utilities';
import { UndeclaredResultError } from './undeclared-result.error';
import { HttpRequestContext } from '../context/request/http-request.context';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../context/request/request-context-token.model';
import { type WebsocketRequestContext } from '../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { XmlWriterUtilities } from '../document/xml-writer.utilities';
import { InternalError } from '../error-handling/internal-error.model';
import { resolveContentDisposition } from '../http/content-disposition.function';
import { HttpRequest } from '../http/http-request.model';
import { HttpResponse } from '../http/http-response.model';
import { HttpStatus } from '../http/http-status.enum';
import { JsonMimeType } from '../http/json-mime-type.type';
import { isJsonResponse } from '../http/json-response.model';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { isRedirectResponse } from '../http/redirect-response.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { JsonOpenApiResponse, OpenApiResponse } from '../open-api/open-api.model';
import { resolveResponseClass } from '../open-api/resolve-response-class.function';
import { FileResponse, isFileResponse } from '../parsing/form-data/file-response.model';
import { buildCspHeaders, CspOptions, CspSource } from '../parsing/html/csp-options.model';
import { HtmlResponse, isHtmlResponse } from '../parsing/html/html-response.model';
import { Newable } from '../types/newable.type';
import { JsonUtilities } from '../utilities/json.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';

/**
 * The format a result is written in.
 */
type ResponseFormat = {
    /**
     * The type it is written as.
     */
    mimeType: JsonMimeType | MimeType.XML,
    /**
     * The model it is written as xml with, if the declaration names one.
     */
    cls: Newable<unknown> | undefined
};

/**
 * Writes what a route handler returned as the response to its request.
 */
export abstract class ResponseWriterUtilities {
    /**
     * Answers a request with what its handler returned, in the status and the format its route declared.
     * @param req - The request.
     * @param res - The response to write.
     * @param result - What the handler returned.
     * @param next - The error handler, for a stream that fails while its head is unsent.
     * @param responses - What the route declares it can answer with.
     * @param route - The route, for the error when the result is none of what it declares.
     * @param chosenStatus - The status the result named itself, if it did.
     * @throws An `UndeclaredResultError` when the result is of a kind the route does not declare.
     */
    static async write(
        req: HttpRequest,
        res: HttpResponse,
        result: unknown,
        next: NextFunction,
        responses: OpenApiResponse[],
        route: string,
        chosenStatus: HttpStatus | undefined = undefined
    ): Promise<void> {
        if (res.headersSent) {
            return;
        }

        // its headers and status, and then its body answered like any other. An etag set here is the
        // one express keeps, and judges an If-None-Match by
        if (isJsonResponse(result)) {
            for (const [name, value] of ObjectUtilities.entries(result.headers)) {
                if (value != undefined) {
                    res.set(name, value);
                }
            }
            await this.write(req, res, result.body, next, responses, route, result.status);
            return;
        }

        const status: HttpStatus | undefined = chosenStatus ?? this.resolveStatus(responses, result);
        if (status != undefined) {
            res.status(status);
        }

        if (result == undefined) {
            res.end();
            return;
        }

        this.validateResultType(responses, result, route);

        if (isFileResponse(result)) {
            this.returnFileResult(res, result, next);
            return;
        }

        if (isHtmlResponse(result)) {
            this.returnHtmlResult(res, result, next);
            return;
        }

        if (isRedirectResponse(result)) {
            res.setHeader(KnownHeader.LOCATION, result.url);
            res.end();
            return;
        }

        const format: ResponseFormat = this.resolveResponseFormat(req, res, responses, result);
        if (format.mimeType === MimeType.XML && format.cls != undefined) {
            res.type(MimeType.XML).send(await XmlWriterUtilities.write(format.cls, result));
            return;
        }

        // serialized once and written. res.json would serialize whatever it is handed, so handing it
        // a parsed copy of a string the framework had already produced meant three passes over the
        // whole graph - and the middle one allocated a second copy of it to throw away.
        res.type(format.mimeType === MimeType.XML ? MimeType.JSON : format.mimeType)
            .send(JsonUtilities.stringify(this.resolveDeclaredBody(responses, result)));
    }

    /**
     * What a JSON result is written with: what the declaration answering for it names. A handler
     * returning a stored row under a declaration of what may leave the server would otherwise send
     * every column the row holds, and the type of the method cannot say so - the row is assignable to
     * the narrower class.
     * @param responses - What the route declares it can answer with.
     * @param result - What the handler returned.
     * @returns The result, without what its declaration does not name; the result itself when no
     * declaration with a class answers for it.
     */
    private static resolveDeclaredBody(responses: OpenApiResponse[], result: unknown): unknown {
        const candidates: JsonOpenApiResponse[] = responses
            .filter((r): r is JsonOpenApiResponse => r.type === 'json' && this.canAnswerWith(r, result));
        const exact: JsonOpenApiResponse[] = candidates.filter(r => {
            const cls: Newable<unknown> | undefined = r.isArray === true ? undefined : resolveResponseClass(r);
            return cls != undefined && result instanceof cls;
        });
        const answering: JsonOpenApiResponse[] = exact.length === 1 ? exact : candidates;
        const classes: (Newable<unknown> | undefined)[] = answering.map(r => resolveResponseClass(r));
        // a declaration naming no class says the body is json, not which: there is nothing to keep to
        if (classes.length === 0 || classes.includes(undefined)) {
            return result;
        }
        const declared: Newable<unknown>[] = classes.filter(cls => cls != undefined);
        return Array.isArray(result)
            ? result.map(item => DeclaredResponseUtilities.resolveDeclaredValue(item, declared))
            : DeclaredResponseUtilities.resolveDeclaredValue(result, declared);
    }

    /**
     * The format a result is written in.
     *
     * Decided by the declaration that answers for the result, the same one its status comes from, and by
     * the formats that declaration names: the request's `Accept` picks among them, and the first is taken
     * when it accepts several or names none.
     * @param req - The request, for what it accepts.
     * @param res - The response, which is told that it varies by what the request accepts.
     * @param responses - What the route declares it can answer with.
     * @param result - What the handler returned.
     * @returns The format, and the model xml is written with. Plain json when nothing names another.
     */
    private static resolveResponseFormat(
        req: HttpRequest,
        res: HttpResponse,
        responses: OpenApiResponse[],
        result: unknown
    ): ResponseFormat {
        const candidates: OpenApiResponse[] = responses.filter(r => this.canAnswerWith(r, result));
        const response: OpenApiResponse | undefined = candidates.length === 1 ? candidates[0] : undefined;
        if (response?.type !== 'json' || response.mimeTypes == undefined) {
            return { mimeType: MimeType.JSON, cls: undefined };
        }
        if (response.mimeTypes.length > 1) {
            // a cache in front of this has to keep the formats apart, or one client gets the other's
            res.vary(KnownHeader.ACCEPT);
        }
        // the 406 before the handler ran made sure the request accepts one of what the route declares
        const accepted: string | false = req.accepts(response.mimeTypes);
        const mimeType: JsonMimeType | MimeType.XML = response.mimeTypes.find(m => m === accepted)
            ?? response.mimeTypes[0]
            ?? MimeType.JSON;
        return { mimeType, cls: resolveResponseClass(response) };
    }

    private static returnFileResult(res: HttpResponse, result: FileResponse, next: NextFunction): void {
        // taken while the request is still running, for a stream that fails once it is over
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        res.setHeader(KnownHeader.CONTENT_TYPE, result.mimeType as MimeType);
        res.setHeader(KnownHeader.CONTENT_DISPOSITION, resolveContentDisposition(result.disposition, result.filename));
        if (result.size != undefined) {
            res.setHeader(KnownHeader.CONTENT_LENGTH, result.size);
        }
        if (result.csp !== false && result.mimeType !== MimeType.SVG) {
            logger.warn('Useless CSP headers found on a file that is not of type svg');
        }
        this.writeCsp(res, result.csp, this.resolveResponseNonce());

        // send file from disk
        if (typeof result.data === 'string') {
            // without its own cache directive, which is `public` and would override the one above
            res.sendFile(result.data, { cacheControl: false });
            return;
        }

        // send file as stream
        res.on('close', () => (result.data as Readable).destroy());
        result.data.on('error', err => this.failStream(logger, res, next, err, [
            KnownHeader.CONTENT_TYPE,
            KnownHeader.CONTENT_LENGTH,
            KnownHeader.CONTENT_DISPOSITION,
            KnownHeader.CONTENT_SECURITY_POLICY
        ])).pipe(res);
    }

    /**
     * Sets the content security policy a response declares, allowing this response's nonce in
     * `script-src`.
     * @param res - The response being written.
     * @param declared - The policy, true for the application's default, or false for none.
     * @param nonce - The nonce of this response.
     */
    private static writeCsp(res: HttpResponse, declared: boolean | CspOptions, nonce: string | undefined): void {
        if (declared === false) {
            return;
        }
        const csp: CspOptions = declared === true ? inject(ZIBRI_DI_TOKENS.DEFAULT_CSP_OPTIONS) : declared;
        res.setHeader(KnownHeader.CONTENT_SECURITY_POLICY, buildCspHeaders(csp, nonce));
        const ancestor: CspSource | undefined = csp.frameAncestors.length === 1 ? csp.frameAncestors[0] : undefined;
        if (ancestor === '\'none\'') {
            res.setHeader(KnownHeader.X_FRAME_OPTIONS, 'DENY');
        }
        else if (ancestor === '\'self\'') {
            // eslint-disable-next-line cspell/spellchecker
            res.setHeader(KnownHeader.X_FRAME_OPTIONS, 'SAMEORIGIN');
        }
    }

    /**
     * Resolves the csp nonce of the response being written.
     * @returns The nonce, or undefined outside a request.
     */
    private static resolveResponseNonce(): string | undefined {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        return context?.get(ZIBRI_REQUEST_CONTEXT_TOKENS.NONCE);
    }

    /**
     * Ends a response whose stream failed part way through.
     *
     * Two different situations wearing one shape, and only one of them can still be answered. While
     * the head is unsent the response can still become an error page, so the headers set for the body
     * that is not coming are taken back off and the error goes to the handler.
     *
     * Once the head is flushed neither is possible. `removeHeader` throws `ERR_HTTP_HEADERS_SENT`
     * there, and it threw from inside an `'error'` listener - outside every `try` around the handler
     * - so `next` was never reached, nothing ended the response, and the caller held an open socket
     * until its own timeout. With the process level handler rethrowing, one failed download ended the
     * process. Any file larger than a single chunk is in this case.
     *
     * What is left once the status is on the wire is to stop: destroying the response closes the
     * connection, which is how a caller learns that a body it was promised is not arriving. Ending it
     * cleanly would present a truncated body as a complete one.
     * @param logger - The logger, taken while the request was still running.
     * @param res - The response being written.
     * @param next - The error handler, for as long as it can still produce a status.
     * @param error - What the stream failed with.
     * @param headers - The headers this response set for the body it is no longer sending.
     */
    private static failStream(logger: LoggerInterface, res: HttpResponse, next: NextFunction, error: Error, headers: KnownHeader[]): void {
        if (res.headersSent) {
            // the only record there will be: the error handler cannot run, so nothing else reports
            // that this download failed
            logger.error(new InternalError('A response stream failed after its headers were sent.', { cause: error }));
            res.destroy();
            return;
        }
        for (const header of headers) {
            res.removeHeader(header);
        }
        next(error);
    }

    private static returnHtmlResult(res: HttpResponse, result: HtmlResponse, next: NextFunction): void {
        // taken while the request is still running, for a stream that fails once it is over
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        res.setHeader(KnownHeader.CONTENT_TYPE, MimeType.HTML);
        const nonce: string | undefined = this.resolveResponseNonce();
        this.writeCsp(res, result.csp, nonce);
        // send html as string
        if (typeof result.data === 'string') {
            // a nonce is only worth something while nobody could have seen it before, and html that
            // outlived the request it was rendered in - a cached page - carries that request's. So
            // its tags are given this response's, the one the header above allows. A stream is
            // written by the request that created it, so its tags already carry the right one
            const html: string = result.nonce != undefined && nonce != undefined && result.nonce !== nonce
                ? result.data.replaceAll(`nonce="${result.nonce}"`, `nonce="${nonce}"`)
                : result.data;
            res.type('.html').send(html);
            return;
        }
        // send html as stream
        res.on('close', () => (result.data as Readable).destroy());
        result.data.on('error', err => this.failStream(logger, res, next, err, [
            KnownHeader.CONTENT_TYPE,
            KnownHeader.CONTENT_SECURITY_POLICY
        ])).pipe(res);
    }

    /**
     * The status a successful result is answered with.
     *
     * A declared status used to be documentation only: a route saying it answers 201 published that
     * and then answered 200 anyway.
     * @param responses - What the route declares it can answer with.
     * @param result - What the handler returned.
     * @returns The status to set, or undefined to leave express's default alone.
     */
    private static resolveStatus(responses: OpenApiResponse[], result: unknown): HttpStatus | undefined {
        // an instance of a declared class picks that declaration outright, which is what tells the
        // two successful outcomes of a rate limited route apart - the reserved one is a class of its
        // own, while a normal handler usually returns a plain object matching nothing exactly
        const exact: OpenApiResponse[] = responses.filter(r => {
            const cls: Newable<unknown> | undefined = r.type === 'json' && r.isArray !== true ? resolveResponseClass(r) : undefined;
            return cls != undefined && result instanceof cls;
        });
        const exactMatch: OpenApiResponse | undefined = exact.length === 1 ? exact[0] : undefined;
        if (exactMatch != undefined) {
            return exactMatch.status;
        }

        const candidates: OpenApiResponse[] = responses.filter(r => this.canAnswerWith(r, result));
        // one declaration that can answer for this value decides. Several cannot be told apart from
        // the value alone, and picking between them would make the status depend on the order the
        // decorators happen to be written in.
        const candidate: OpenApiResponse | undefined = candidates.length === 1 ? candidates[0] : undefined;
        const status: HttpStatus | undefined = candidate?.status;

        if (result == undefined) {
            // nothing to send, and 204 says so. A 200 with an empty body leaves every client to find
            // that out by trying to parse one.
            return status ?? HttpStatus.NO_CONTENT;
        }
        return status;
    }

    /**
     * Whether the given declaration could be describing this value.
     * @param response - The declared response.
     * @param result - What the handler returned.
     * @returns True when the value has the shape the declaration describes.
     */
    private static canAnswerWith(response: OpenApiResponse, result: unknown): boolean {
        switch (response.type) {
            case 'error': {
                // never a successful result. What the error handler answers with is its own business
                return false;
            }
            case 'file': {
                return isFileResponse(result);
            }
            case 'html': {
                return isHtmlResponse(result);
            }
            case 'redirect': {
                return isRedirectResponse(result);
            }
            case 'empty': {
                // describes nothing being returned, and only that
                return result == undefined;
            }
            case 'json': {
                if (result == undefined) {
                    return false;
                }
                return response.isArray === true ? Array.isArray(result) : !Array.isArray(result);
            }
        }
    }

    // a request-time failure, so not an InitRouterError: that one reads as the application failing to
    // start, and whoever debugs this 500 needs the route and what it returned instead
    private static validateResultType(responses: OpenApiResponse[], result: {}, route: string): void {
        // what a returned value is checked against: an empty response never describes one, and neither
        // does an error response
        const bodies: OpenApiResponse[] = responses.filter(r => r.type !== 'error' && r.type !== 'empty');
        if (bodies.some(r => r.type === 'json') // all responses with a body are json responses
            && bodies.length === bodies.filter(r => r.type === 'json').length
            && (isFileResponse(result) || isHtmlResponse(result) || isRedirectResponse(result))) {
            const returned: string = isFileResponse(result)
                ? 'a FileResponse'
                : isHtmlResponse(result) ? 'an HtmlResponse' : 'a RedirectResponse';
            throw new UndeclaredResultError(route, `returned ${returned}, but declares only json responses`);
        }

        if (bodies.some(r => r.type === 'redirect') // all responses with a body are redirects
            && bodies.length === bodies.filter(r => r.type === 'redirect').length
            && !isRedirectResponse(result)) {
            throw new UndeclaredResultError(route, 'declares only redirect responses, but did not return a RedirectResponse');
        }

        if (bodies.some(r => r.type === 'file') // all responses with a body are file responses
            && bodies.length === bodies.filter(r => r.type === 'file').length
            && !isFileResponse(result)) {
            throw new UndeclaredResultError(route, 'declares only file responses, but did not return a FileResponse');
        }

        if (bodies.some(r => r.type === 'html') // all responses with a body are html responses
            && bodies.length === bodies.filter(r => r.type === 'html').length
            && !isHtmlResponse(result)) {
            throw new UndeclaredResultError(route, 'declares only html responses, but did not return an HtmlResponse');
        }
    }
}