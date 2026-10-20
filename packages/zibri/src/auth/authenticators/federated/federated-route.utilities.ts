import { Readable } from 'node:stream';

import { FederatedAuthenticatorInterface, isFederatedAuthenticator } from './federated-authenticator.interface.ts';
import { FederatedCallbackForm } from './federated-callback-form.model.ts';
import { FederatedMetadata } from './federated-metadata.model.ts';
import { FederatedProviderLogoutMessage } from './federated-provider-logout-message.model.ts';
import { FederatedProviderLogout } from './federated-provider-logout.model.ts';
import { FederatedSignInFailure } from './federated-sign-in-failure.enum.ts';
import { FederatedSignInError } from './federated-sign-in.error.ts';
import { FederatedSoapLogout } from './federated-soap-logout.model.ts';
import { FederationOptions } from './federation-options.model.ts';
import { HttpRequestContext } from '../../../context/request/http-request.context.ts';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../../../context/request/request-context-token.model.ts';
import { WebsocketRequestContext } from '../../../context/request/websocket-request.context.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { NoProviderError } from '../../../di/errors/no-provider.error.ts';
import { inject } from '../../../di/inject.function.ts';
import { ErrorUtilities } from '../../../error-handling/error.utilities.ts';
import { NotFoundError } from '../../../error-handling/errors/not-found.error.ts';
import { InternalError } from '../../../error-handling/internal-error.model.ts';
import { GlobalRegistry } from '../../../global/global-registry.ts';
import { HttpMethod } from '../../../http/http-method.enum.ts';
import { MimeType } from '../../../http/mime-type.enum.ts';
import { RedirectResponse } from '../../../http/redirect-response.model.ts';
import { $ts } from '../../../localization/translate.function.ts';
import { AuditAction, AuditOutcome } from '../../../logging/audit-event.model.ts';
import { auditReasonFor } from '../../../logging/audit-reason-for.function.ts';
import { FileResponse } from '../../../parsing/form-data/file-response.model.ts';
import { CspSource } from '../../../parsing/html/csp-options.model.ts';
import { HtmlResponse } from '../../../parsing/html/html-response.model.ts';
import { Newable } from '../../../types/newable.type.ts';
import { BaseUser } from '../../models/base-user.model.ts';
import { Authenticators } from '../authenticators.model.ts';

/**
 * A class of an authenticator that signs users in at a provider.
 */
type FederatedAuthenticatorClass = Newable<FederatedAuthenticatorInterface<string, BaseUser<string>>>;

/**
 * What the routes of a sign-in at a provider share, whichever strategy they log in with.
 */
export abstract class FederatedRouteUtilities {
    /**
     * Finds the authenticator of the provider a route names.
     * @param provider - The name in the route.
     * @returns The authenticator class.
     * @throws NotFoundError when the application has no provider of that name.
     */
    static resolveAuthenticator(provider: string): FederatedAuthenticatorClass {
        const authenticator: FederatedAuthenticatorClass | undefined = this.findAuthenticator(provider);
        if (authenticator == undefined) {
            throw new NotFoundError($ts`There is no provider "${provider}".`);
        }
        return authenticator;
    }

    /**
     * Finds the authenticators of the application that sign users in at a provider.
     * @param authenticators - The authenticators of the application.
     * @returns The ones implementing `FederatedAuthenticatorInterface`.
     */
    static findAuthenticators(authenticators: Authenticators): FederatedAuthenticatorClass[] {
        return authenticators.filter(
            (authenticator): authenticator is FederatedAuthenticatorClass => isFederatedAuthenticator(inject(authenticator))
        );
    }

    /**
     * Checks that every url a provider's authenticator gives out is one of the application's routes:
     * below its `baseUrl`, and matched by a route it registered for the method the browser requests it with.
     * @param authenticator - The authenticator class.
     * @throws When the application has no `baseUrl`, or a url is not below it or reaches no route
     * answering its method.
     */
    static validateRouteUrls(authenticator: FederatedAuthenticatorClass): void {
        const baseUrl: string | undefined = GlobalRegistry.getAppData('baseUrl');
        if (baseUrl == undefined) {
            throw new InternalError(`${authenticator.name} gives out urls below the baseUrl of the application, which is not set.`);
        }
        const base: URL = new URL(baseUrl);
        // a path of the baseUrl is one a proxy in front of the application forwards without, so the
        // routes are matched with what follows it
        const basePath: string = base.pathname.replace(/\/+$/, '');
        const instance: FederatedAuthenticatorInterface<string, BaseUser<string>> = inject(authenticator);
        for (const { route, method } of instance.routes) {
            const url: URL = new URL(instance.resolveRouteUrl(route));
            if (url.origin !== base.origin || (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`))) {
                throw new InternalError(
                    `${authenticator.name} gives out ${url.href} for its ${route} route, which is not below the baseUrl ${baseUrl} of the application.`
                );
            }
            const path: string = url.pathname.slice(basePath.length) || '/';
            const methods: HttpMethod[] = inject(ZIBRI_DI_TOKENS.ROUTER).findMethods(path);
            if (!methods.length) {
                throw new InternalError(
                    `${authenticator.name} gives out ${url.href} for its ${route} route, which no route of the application answers at ${path}.`
                );
            }
            if (!methods.includes(method)) {
                throw new InternalError(
                    `${authenticator.name} gives out ${url.href} for its ${route} route, which the browser requests with ${method}, and the application answers at ${path} only with ${methods.join(', ')}.`
                );
            }
        }
    }

    /**
     * The origins whose pages may post a provider's answer to its callback, for `@AcceptCrossSitePosts`.
     * @param pathParams - The parameters of the callback's path, which name the provider.
     * @returns The origin of the provider's sign-in page when it answers with a form post, none otherwise.
     */
    static async resolveFormPostOrigins(pathParams: Record<string, string>): Promise<string[]> {
        const provider: string | undefined = pathParams['provider'];
        const authenticator: FederatedAuthenticatorClass | undefined = provider == undefined
            ? undefined
            : this.findAuthenticator(provider);
        return authenticator == undefined ? [] : await inject(authenticator).resolveFormPostOrigins();
    }

    /**
     * Sends the browser on to the provider to connect it to an account, with the code of the connection.
     * @param provider - The name in the route.
     * @param code - The one-time code `startConnection` put into the url.
     * @returns The redirect to the provider, or to the error url when the code is not good.
     */
    static async resolveConnectionRedirect(provider: string, code: string): Promise<RedirectResponse> {
        try {
            return RedirectResponse.to(await inject(this.resolveAuthenticator(provider)).continueConnection(code));
        }
        catch (error) {
            return this.toFailure(error);
        }
    }

    /**
     * Reads the scopes of a provider's apis a sign-in asks for, from the authorize route's query.
     * @param scopes - The `scopes` of the query, separated by spaces as OAuth2 separates them.
     * @returns The scopes, none when the query names none.
     */
    static toApiScopes(scopes: string | undefined): string[] {
        return scopes?.split(' ').filter(scope => scope !== '') ?? [];
    }

    /**
     * Reads the query the provider sent the browser back with, exactly as it was sent.
     * @returns The query.
     * @throws When not inside a http request.
     */
    static resolveCallbackQuery(): URLSearchParams {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!(context instanceof HttpRequestContext)) {
            throw new InternalError('The callback of a sign-in runs inside an http request.');
        }
        const url: string = context.request.originalUrl;
        return new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '');
    }

    /**
     * Reads the query a provider sent the browser to the logout route with, exactly as it was sent.
     * @returns The logout message of the redirect.
     * @throws When not inside a http request.
     */
    static resolveRedirectedLogout(): FederatedProviderLogoutMessage {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!(context instanceof HttpRequestContext)) {
            throw new InternalError('A logout at a provider runs inside an http request.');
        }
        const url: string = context.request.originalUrl;
        const rawQuery: string = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
        return { binding: 'redirect', query: new URLSearchParams(rawQuery), rawQuery };
    }

    /**
     * Takes what a provider sent the browser to the logout route with: ends the logins of a session
     * the user logged out of there and tells the provider, or lands the browser on `signedOutUrl` once
     * the provider ended a session a logout here sent it to end.
     * @param provider - The name in the route.
     * @param message - The query of a redirect, or the fields of a posted form.
     * @returns Where the browser goes on to: a redirect, or a page posting a form to the provider.
     * @throws NotFoundError when the application has no provider of that name, or it cannot be logged out at.
     */
    static async completeProviderLogout(
        provider: string,
        message: FederatedProviderLogoutMessage
    ): Promise<RedirectResponse | HtmlResponse> {
        const logout: FederatedProviderLogout = await inject(this.resolveAuthenticator(provider)).readProviderLogout(message);
        if (logout.type === 'response') {
            return this.toSignedOut(provider);
        }
        await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).endFederatedLogins(logout.session, undefined);
        inject(ZIBRI_DI_TOKENS.LOGGER).audit({ action: AuditAction.LOGOUT, outcome: AuditOutcome.SUCCESS });
        if (logout.answer == undefined) {
            return this.toSignedOut(provider);
        }
        return logout.answer.binding === 'redirect'
            ? RedirectResponse.to(new URL(logout.answer.url))
            : this.toAutoPostedForm(logout.answer.url, logout.answer.fields);
    }

    /**
     * Takes a logout request a provider sent server to server in a SOAP envelope: ends the logins of
     * the session the user logged out of there, and answers the provider.
     * @param provider - The name in the route.
     * @param envelope - The envelope, exactly as it arrived.
     * @returns The envelope the provider is answered with.
     * @throws NotFoundError when the application has no provider of that name, or it takes no such requests.
     */
    static async completeSoapLogout(provider: string, envelope: string): Promise<FileResponse> {
        const logout: FederatedSoapLogout = await inject(this.resolveAuthenticator(provider)).resolveSoapLogout(envelope);
        await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).endFederatedLogins(logout.session, undefined);
        inject(ZIBRI_DI_TOKENS.LOGGER).audit({ action: AuditAction.LOGOUT, outcome: AuditOutcome.SUCCESS });
        // a file rather than a model written as xml, since it is signed and has to arrive as it was written
        return FileResponse.fromStream({
            stream: Readable.from([logout.answer]),
            filename: 'logout-response.xml',
            mimeType: MimeType.TEXT_XML,
            size: Buffer.byteLength(logout.answer)
        });
    }

    /**
     * Reads the form the provider posted to the callback, the same way the query of a redirect is read.
     * @param form - The form, with every field the provider sent.
     * @returns Its fields.
     */
    static toCallbackParams(form: FederatedCallbackForm): URLSearchParams {
        const params: URLSearchParams = new URLSearchParams();
        for (const [name, value] of Object.entries(form)) {
            for (const item of Array.isArray(value) ? value : [value]) {
                if (typeof item === 'string') {
                    params.append(name, item);
                }
            }
        }
        return params;
    }

    /**
     * The document a provider's authenticator publishes about the application, for the provider to be
     * set up with.
     * @param provider - The name in the route.
     * @returns The document.
     * @throws NotFoundError when the application has no provider of that name, or it publishes nothing.
     */
    static async toMetadata(provider: string): Promise<FileResponse> {
        const metadata: FederatedMetadata | undefined = await inject(this.resolveAuthenticator(provider)).resolveMetadata();
        if (metadata == undefined) {
            throw new NotFoundError($ts`The provider "${provider}" publishes no metadata.`);
        }
        return FileResponse.fromStream({
            stream: Readable.from([metadata.content]),
            filename: `${provider}-metadata.xml`,
            mimeType: metadata.mimeType,
            size: Buffer.byteLength(metadata.content)
        });
    }

    /**
     * Sends the browser to the registration, with the ticket the sign-in continues with.
     * @param ticket - The ticket.
     * @returns The redirect.
     */
    static toRegistration(ticket: string): RedirectResponse {
        const url: URL = new URL(this.resolveOptions().registrationUrl);
        url.searchParams.set('ticket', ticket);
        return RedirectResponse.to(url);
    }

    /**
     * Sends the browser on once a provider is connected to an account, and records the link.
     * @param userId - The user the identity is linked to.
     * @param redirectTo - Where the connection goes, one of the allowed redirects.
     * @returns The redirect.
     */
    static toConnection(userId: string, redirectTo: string): RedirectResponse {
        inject(ZIBRI_DI_TOKENS.LOGGER).audit({ action: AuditAction.IDENTITY_LINKED, outcome: AuditOutcome.SUCCESS, userId });
        return RedirectResponse.to(new URL(redirectTo));
    }

    /**
     * Sends the browser on once the sign-in is done.
     * @param redirectTo - Where the sign-in goes, one of the allowed redirects.
     * @param code - The one-time code the login is handed over with. Undefined when the sign-in logged in on
     * the redirect back.
     * @returns The redirect.
     */
    static toRedirect(redirectTo: string, code: string | undefined): RedirectResponse {
        const url: URL = new URL(redirectTo);
        if (code != undefined) {
            url.searchParams.set('code', code);
        }
        return RedirectResponse.to(url);
    }

    /**
     * Sends the browser to the error url when the sign-in was refused, and records the refusal.
     *
     * A fault is thrown on rather than turned into a redirect: it is not something the user did, and
     * folding it in would make an outage look like a failed sign-in.
     * @param error - Why the sign-in did not complete.
     * @returns The redirect.
     * @throws The error, when it is a fault rather than a refusal.
     */
    static toFailure(error: unknown): RedirectResponse {
        if (!ErrorUtilities.isRefusal(error)) {
            throw error;
        }
        inject(ZIBRI_DI_TOKENS.LOGGER).audit({
            action: error instanceof FederatedSignInError ? error.action : AuditAction.LOGIN,
            outcome: AuditOutcome.FAILURE,
            reason: auditReasonFor(error)
        });
        const url: URL = new URL(this.resolveOptions().errorUrl);
        url.searchParams.set('error', error instanceof FederatedSignInError ? error.failure : FederatedSignInFailure.EXPIRED);
        return RedirectResponse.to(url);
    }

    /**
     * Lands the browser on `signedOutUrl`.
     * @param provider - The name in the route, for the message when it is not set.
     * @returns The redirect.
     * @throws InternalError when `FEDERATION_OPTIONS` name no `signedOutUrl`.
     */
    private static toSignedOut(provider: string): RedirectResponse {
        const signedOutUrl: string | undefined = this.resolveOptions().signedOutUrl;
        if (signedOutUrl == undefined) {
            throw new InternalError(`FEDERATION_OPTIONS name no signedOutUrl to land on after a logout at ${provider}.`);
        }
        return RedirectResponse.to(new URL(signedOutUrl));
    }

    /**
     * A page that posts a form to a provider on its own, as the HTTP-POST binding sends a message.
     *
     * Its policy lets it post to that provider and run its one script, and nothing else. Without
     * scripts, a button posts the form.
     * @param url - Where the form is posted.
     * @param fields - Its fields.
     * @returns The page.
     */
    private static toAutoPostedForm(url: string, fields: Record<string, string>): HtmlResponse {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        const nonce: string | undefined = context?.get(ZIBRI_REQUEST_CONTEXT_TOKENS.NONCE);
        const inputs: string = Object.entries(fields)
            .map(([name, value]) => `<input type="hidden" name="${this.escape(name)}" value="${this.escape(value)}">`)
            .join('');
        const target: URL = new URL(url);
        const html: string = [
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Logging out</title></head><body>',
            `<form method="post" action="${this.escape(url)}">${inputs}<noscript><button type="submit">Continue</button></noscript></form>`,
            // eslint-disable-next-line sonarjs/no-nested-template-literals
            `<script${nonce == undefined ? '' : ` nonce="${this.escape(nonce)}"`}>document.forms[0].submit()</script>`,
            '</body></html>'
        ].join('');
        const formAction: CspSource = target.protocol === 'https:' ? `https://${target.host}` : `http://${target.host}`;
        return HtmlResponse.fromString(html, { csp: { formAction: [formAction] } });
    }

    private static escape(value: string): string {
        return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;');
    }

    private static findAuthenticator(provider: string): FederatedAuthenticatorClass | undefined {
        return this.findAuthenticators(inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).authenticators).find(a => inject(a).name === provider);
    }

    private static resolveOptions(): FederationOptions {
        const options: FederationOptions | undefined = inject(ZIBRI_DI_TOKENS.FEDERATION_OPTIONS);
        if (options == undefined) {
            throw new NoProviderError(ZIBRI_DI_TOKENS.FEDERATION_OPTIONS, []);
        }
        return options;
    }
}