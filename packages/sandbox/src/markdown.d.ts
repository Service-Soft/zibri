// a .md or .mdx file in src/templates is a page, its frontmatter and headings beside it
declare module '*.md' {
    export const frontmatter: import('zibri').MdxFrontmatter;
    export const headings: import('zibri').MdxHeading[];
    const page: import('zibri').MdxPage;
    export default page;
}
declare module '*.mdx' {
    export const frontmatter: import('zibri').MdxFrontmatter;
    export const headings: import('zibri').MdxHeading[];
    const page: import('zibri').MdxPage;
    export default page;
}