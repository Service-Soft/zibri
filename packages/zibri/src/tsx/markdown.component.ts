import { MdxComponents } from 'zibri-tsx';
import { defineServerComponent, isCompiledComponent } from 'zibri-tsx/internal';

import { TsxComponent } from './tsx-component.model';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * The props of {@link Markdown}.
 */
export type MarkdownProps = {
    /**
     * The markdown. It is never compiled, and holds nothing but markdown.
     */
    source: string,
    /**
     * The components its constructs render, over the ones of `MdxComponentsContext`.
     */
    components?: MdxComponents
};

/**
 * Renders markdown the server gets while it runs, such as from a database, as a `.md` template renders: through the
 * page `ZIBRI_DI_TOKENS.MARKDOWN_SERVICE` resolves. Needs `renderAtRuntime` of `ZIBRI_DI_TOKENS.MARKDOWN_OPTIONS`.
 * ```tsx
 * <Markdown source={post.body}/>
 * ```
 */
export const Markdown: TsxComponent<MarkdownProps> = defineServerComponent<MarkdownProps>('Markdown', (props, $ssr) => {
    const page: unknown = inject(ZIBRI_DI_TOKENS.MARKDOWN_SERVICE).resolvePage(props.source);
    if (!isCompiledComponent(page)) {
        throw new InternalError('The page ZIBRI_DI_TOKENS.MARKDOWN_SERVICE resolves was not compiled by zibri-tsx.');
    }
    return $ssr.component(page, { components: props.components });
});