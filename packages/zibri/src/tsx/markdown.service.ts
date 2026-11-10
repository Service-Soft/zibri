import type * as ZibriMdx from 'zibri-mdx';
import { MdxComponents, MdxComponentsContext, MdxPage, MdxPageProps } from 'zibri-tsx';
import { defineServerComponent } from 'zibri-tsx/internal';

import { type MarkdownOptions } from './markdown-options.model';
import { MarkdownServiceInterface } from './markdown-service.interface';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { InternalError } from '../error-handling/internal-error.model';
import { OnAppInit } from '../global/on-app-init.interface';
import { resolveApplicationPackage } from '../utilities/optional-peer.function';

/**
 * What renders the markdown, which the error names when the package is missing.
 */
const NEEDED_FOR: string = 'Rendering markdown at runtime (renderAtRuntime of ZIBRI_DI_TOKENS.MARKDOWN_OPTIONS)';

/**
 * Default markdown service of Zibri: renders markdown with the package `zibri-mdx`, which the application installs.
 */
@Injectable({ register: 'onUse' })
export class MarkdownService implements MarkdownServiceInterface, OnAppInit {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.MARKDOWN_OPTIONS)
        private readonly options: MarkdownOptions
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(): void {
        // while the application starts, so a deployment without the package fails there rather than on the first page
        // rendering markdown. An application rendering none needs nothing
        if (this.options.renderAtRuntime) {
            this.resolveRenderer();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolvePage(source: string): MdxPage {
        if (!this.options.renderAtRuntime) {
            throw new InternalError([
                'Rendering markdown at runtime needs renderAtRuntime: true in ZIBRI_DI_TOKENS.MARKDOWN_OPTIONS, and the',
                'package zibri-mdx in the dependencies of the application.'
            ]);
        }
        const renderer: typeof ZibriMdx.MarkdownRendererUtilities = this.resolveRenderer();
        return defineServerComponent<MdxPageProps>('Markdown', (props, $ssr) => {
            // chosen as a .md template chooses them: its prop over the context
            const components: MdxComponents = { ...$ssr.useContext(MdxComponentsContext), ...props.components };
            return renderer.renderMarkdown(source, components, $ssr);
        });
    }

    // loaded from the application, which zibri names nowhere: npm keeps a package a production one names in a deployment,
    // even an optional peer, and an application rendering no markdown at runtime carries none of it
    private resolveRenderer(): typeof ZibriMdx.MarkdownRendererUtilities {
        return resolveApplicationPackage<typeof ZibriMdx>('zibri-mdx', NEEDED_FOR, 'npm i zibri-mdx').MarkdownRendererUtilities;
    }
}