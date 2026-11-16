/**
 * How the application renders markdown, through `ZIBRI_DI_TOKENS.MARKDOWN_OPTIONS`.
 */
export type MarkdownOptions = {
    /**
     * Whether `Markdown` renders markdown the server gets while it runs, such as from a database. The application then
     * lists the package `zibri-mdx` in its dependencies, which it checks for while it starts. False by default, which
     * needs no package and refuses to render such markdown.
     */
    renderAtRuntime: boolean
};