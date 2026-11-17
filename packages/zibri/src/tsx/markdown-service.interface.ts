import { MdxPage } from 'zibri-tsx';

/**
 * Renders markdown the server gets while it runs, such as from a database. Replaceable through
 * `ZIBRI_DI_TOKENS.MARKDOWN_SERVICE`.
 */
export interface MarkdownServiceInterface {
    /**
     * Resolves the page markdown renders, as a `.md` template does: each construct renders the component chosen for
     * it, from the `components` prop of the page, then from `MdxComponentsContext`, then its plain element.
     * @param source - The markdown. It is never compiled, and holds nothing but markdown.
     * @returns The page.
     * @throws When `renderAtRuntime` of `ZIBRI_DI_TOKENS.MARKDOWN_OPTIONS` is not set.
     */
    resolvePage: (source: string) => MdxPage
}