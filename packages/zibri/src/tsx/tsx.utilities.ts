import { CompiledPage, createServerRuntime, renderChild, renderPage, RenderServerRuntime } from 'zibri-tsx';

import { TsxComponent } from './tsx-component.model';
import { TsxEmailComponent } from './tsx-email-component.model';
import { TsxLocaleData } from './tsx-locale-data.model';
import { HttpRequestContext } from '../context/request/http-request.context';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../context/request/request-context-token.model';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { InternalError } from '../error-handling/internal-error.model';

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
     * Renders the given component as an email, so no script injection is happening.
     * @example
     * ```ts
     * TsxUtilities.renderEmail(TestEmail, { recipient: 'James Smith' });
     * ```
     * @param args - Component and props.
     * @param args.component - The function component to render.
     * @param args.props - The properties to pass into the component.
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
        const runtime: RenderServerRuntime = createServerRuntime();

        return `<!DOCTYPE html>\n${renderChild(compiled.render(this.toPropsRecord(props), runtime))}`;
    }

    /**
     * Renders the given component as a page, including the script tag that restores client side
     * interactivity for any `onClient` blocks and event handlers the template declares.
     * @example
     * ```ts
     * TsxUtilities.renderPage(TestPage, { initialCount: 1 });
     * ```
     * @param args - Component and props.
     * @param args.component - The function component to render.
     * @param args.props - The properties to pass into the component.
     * @returns The fully rendered html string, with the client script attached in a script tag.
     */
    static renderPage<T = {}>(
        ...args: keyof T extends never
            ? [component: TsxComponent<T>]
            : [component: TsxComponent<T>, props: T]
    ): string {
        const [component, props] = args;

        return renderPage(this.toCompiledComponent(component), this.toPropsRecord(props), {
            nonce: this.resolveNonce(),
            localeData: new TsxLocaleData()
        });
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
        if (this.isCompiledComponent(value)) {
            return value;
        }
        throw new InternalError([
            `The template '${this.nameOf(component)}' was not compiled by zibri-tsx.`,
            'Route your template files through the zibri-tsx webpack loader, for example:',
            '{ test: /\\.tsx$/, include: /src[\\\\/]templates/, use: \'zibri-tsx/webpack\' }'
        ].join('\n'));
    }

    /**
     * Whether the given value is a compiled component emitted by zibri-tsx.
     * @param value - The value to check.
     * @returns True when the value can be rendered.
     */
    private static isCompiledComponent(value: unknown): value is CompiledPage {
        if (typeof value !== 'object' || value === null) {
            return false;
        }
        const candidate: Partial<CompiledPage> = value as Partial<CompiledPage>;
        return typeof candidate.name === 'string'
            && typeof candidate.render === 'function'
            && typeof candidate.client === 'object';
    }

    /**
     * Names the given template for error messages.
     * @param component - The imported template component.
     * @returns The component name, or a placeholder when it has none.
     */
    private static nameOf(component: unknown): string {
        if (typeof component === 'function') {
            return component.name || 'anonymous';
        }
        return 'unknown';
    }

    /**
     * Narrows props to the record shape the compiled render function takes. The cast is needed
     * because T is the template's own props type, which carries no index signature.
     * @param props - The props to render with, if any.
     * @returns The props as a record.
     */
    private static toPropsRecord<T>(props: T | undefined): Record<string, unknown> {
        return (props ?? {}) as Record<string, unknown>;
    }
}