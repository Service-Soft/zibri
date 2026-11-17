import { MdxFrontmatter, MdxHeading, MdxPage } from 'zibri-tsx';

import { Route } from '../../routing/controller-route-configuration.model';

/**
 * A page of the documentation as its module exports it: `import * as gettingStarted from './getting-started.md'`.
 */
export type DocsPageModule = {
    /**
     * The page.
     */
    default: MdxPage,
    /**
     * Its frontmatter. A list of strings under `keywords` are other words the search finds the page by.
     */
    frontmatter: MdxFrontmatter,
    /**
     * Its headings, which the sections of the page and the search are built of.
     */
    headings: MdxHeading[]
};

/**
 * A page of the documentation, named by its file below the folder of the pages, such as `guides/writing-a-page.md`.
 */
export type DocsPage = {
    /**
     * The file, which gives the page its address.
     */
    file: string,
    /**
     * What the file exports.
     */
    module: DocsPageModule
};

/**
 * A folder of pages, listed under its title.
 */
export type DocsFolder = {
    /**
     * What the navigation and the search call it, such as `Guides`.
     */
    title: string,
    /**
     * Its pages, in their order.
     */
    pages: DocsPage[]
};

/**
 * What the navigation lists: a page on its own, or a folder of them.
 */
export type DocsNavigationEntry = DocsPage | DocsFolder;

/**
 * The documentation an application serves: where, and its pages.
 */
export type DocsSite = {
    /**
     * Where it is served, such as `/docs`, without a slash at its end. The path of the controller serving it.
     */
    basePath: Route,
    /**
     * The file of the page served at the base path itself, such as `getting-started.md`.
     */
    homePage: string,
    /**
     * What the search names as the place of a page outside any folder, such as the name of the application.
     */
    title: string,
    /**
     * The pages and folders, in the order the navigation lists them.
     */
    navigation: DocsNavigationEntry[]
};