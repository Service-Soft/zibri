// what the frontmatter of a page may hold
declare module 'zibri-tsx' {
    interface MdxFrontmatter {
        // other words for what the page is about, which the search finds it by, such as `sign in` for logging in
        keywords?: string[]
    }
}

export {};