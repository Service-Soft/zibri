import { CompiledPage, MdxComponentsContext, renderPage } from 'zibri-tsx';
import { createServerRuntime, isCompiledComponent, renderChild, RenderServerRuntime } from 'zibri-tsx/internal';

import { TsxComponent } from './tsx-component.model';
import { TsxEmailComponent } from './tsx-email-component.model';
import { TsxLocaleData } from './tsx-locale-data.model';
import { ZibriEnvironment } from '../application/zibri-environment.type';
import { HttpRequestContext } from '../context/request/http-request.context';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../context/request/request-context-token.model';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { InternalError } from '../error-handling/internal-error.model';
import { GlobalRegistry } from '../global/global-registry';

/**
 * Utilities for handling tsx templates.
 *
 * Templates are compiled ahead of time by zibri-tsx, so at runtime these methods only run the
 * generated render function and assemble the document. The value a template module exports is a
 * compiled component object, even though it is declared as a {@link TsxComponent} function so the
 * template itself type checks as tsx.
 */
export abstract class TsxUtilities {
    /**
     * Renders the given component as an email, so no script injection is happening. A page written in markdown the
     * email renders renders the components `ZIBRI_DI_TOKENS.MDX_EMAIL_COMPONENTS` names for its constructs.
     * @example
     * ```ts
     * TsxUtilities.renderEmail(TestEmail, { recipient: 'James Smith' });
     * ```
     * @param args - The function component to render, followed by the properties to pass into it
     * when it takes any.
     * @returns The fully rendered html.
     */
    static renderEmail<T = {}>(
        ...args: keyof T extends never
            ? [component: TsxEmailComponent<T>]
            : [component: TsxEmailComponent<T>, props: T]
    ): string {
        const [component, props] = args;
        const compiled: CompiledPage = this.toCompiledComponent(component);
        // A fresh runtime per render; its handler and client instance registries are simply ignored,
        // which is what makes this the script free variant of renderPage.
        const runtime: RenderServerRuntime = createServerRuntime(this.resolveEnvironment());
        // an email client loads no stylesheet, so an email has components of its own for markdown
        runtime.provideContext(MdxComponentsContext, inject(ZIBRI_DI_TOKENS.MDX_EMAIL_COMPONENTS));

        return `<!DOCTYPE html>\n${renderChild(compiled.render(this.toPropsRecord(props), runtime))}`;
    }

    /**
     * Renders the given component as a page, including the script tag that restores client side
     * interactivity for any `onClient` blocks and event handlers the template declares. A page written in markdown,
     * and every one the page renders, renders the components `ZIBRI_DI_TOKENS.MDX_COMPONENTS` names for its
     * constructs.
     * @example
     * ```ts
     * TsxUtilities.renderPage(TestPage, { initialCount: 1 });
     * ```
     * @param args - The function component to render, followed by the properties to pass into it
     * when it takes any. They may be left out when every one of them is optional.
     * @returns The fully rendered html string, with the client script attached in a script tag.
     */
    static renderPage<T = {}>(
        ...args: keyof T extends never
            ? [component: TsxComponent<T>]
            : {} extends T
                ? [component: TsxComponent<T>, props?: T]
                : [component: TsxComponent<T>, props: T]
    ): string {
        const [component, props] = args;

        return renderPage(this.toCompiledComponent(component), this.toPropsRecord(props), {
            environment: this.resolveEnvironment(),
            nonce: this.resolveNonce(),
            localeData: new TsxLocaleData(),
            // the build writes the vendor bundles into the public assets, so they are served where those are
            vendorUrlPrefix: `${inject(ZIBRI_DI_TOKENS.ASSET_SERVICE).assetsRoute}/vendor/`,
            contexts: [{ context: MdxComponentsContext, value: inject(ZIBRI_DI_TOKENS.MDX_COMPONENTS) }]
        });
    }

    /**
     * Resolves the environment of the application, which decides what a mistake only the render can see
     * does: it throws in `development`, and is logged in `production`, which renders the page degraded.
     * @returns The environment.
     * @throws An InternalError when no application was created, as nothing says which it is.
     */
    private static resolveEnvironment(): ZibriEnvironment {
        const environment: ZibriEnvironment | undefined = GlobalRegistry.getAppData('environment');
        if (environment == undefined) {
            throw new InternalError([
                'A tsx template is rendered before any application was created, and the environment of the application',
                'decides what a mistake only the render can see does. Render templates in a created application.'
            ]);
        }
        return environment;
    }

    /**
     * Resolves the csp nonce of the current request, so the injected script tag is allowed to run.
     * @returns The nonce, or undefined when the request uses none.
     */
    private static resolveNonce(): string | undefined {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(
            ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT
        );
        return context?.get(ZIBRI_REQUEST_CONTEXT_TOKENS.NONCE);
    }

    /**
     * Unwraps the compiled component that the zibri-tsx build step put in place of the template's
     * component function.
     * @param component - The imported template component.
     * @returns The compiled component.
     * @throws When the template was not compiled, which means the build is not set up correctly.
     */
    private static toCompiledComponent<T>(component: TsxComponent<T>): CompiledPage {
        const value: unknown = component;
        if (isCompiledComponent(value)) {
            return value;
        }
        throw new InternalError([
            `The template '${this.nameOf(component)}' was not compiled by zibri-tsx.`,
            'Route your template files through the webpack loader of zibri-tsx-compiler, for example:',
            '{ test: /\\.(tsx|mdx?)$/, include: /src[\\\\/]templates/, use: \'zibri-tsx-compiler/webpack\' }'
        ].join('\n'));
    }

    /**
     * Names the given template for error messages.
     * @param component - The imported template component.
     * @returns The component name, or a placeholder when it has none.
     */
    private static nameOf(component: unknown): string {
        return typeof component === 'function' ? component.name || 'anonymous' : 'unknown';
    }

    /**
     * Narrows props to the record shape the compiled render function takes. The cast is needed
     * because T is the template's own props type, which carries no index signature.
     * @param props - The props to render with, if any.
     * @returns The props as a record.
     */
    private static toPropsRecord<T>(props: T | undefined): Record<string, unknown> {
        return props ?? {};
    }
}