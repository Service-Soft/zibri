// a page of the documentation, its frontmatter and headings beside it
declare module '*.md' {
    export const frontmatter: import('zibri').MdxFrontmatter;
    export const headings: import('zibri').MdxHeading[];
    const page: import('zibri').MdxPage;
    export default page;
}