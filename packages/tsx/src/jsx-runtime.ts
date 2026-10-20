import { IntrinsicElements as HtmlIntrinsicElements } from './jsx/intrinsic-elements.model.ts';
import { TsxChildren, TsxElement } from './jsx/jsx.model.ts';

/**
 * The jsx contract typescript resolves through `jsxImportSource: 'zibri-tsx'`.
 *
 * It has to be a namespace called `JSX`, because that is what the compiler looks up in the jsx
 * runtime module — a type alias or an interface is not considered.
 */
// eslint-disable-next-line typescript/no-namespace
export namespace JSX {
    /**
     * What a jsx expression evaluates to.
     */
    export type Element = TsxElement;

    /**
     * The html elements that can be used in a template.
     */
    export type IntrinsicElements = HtmlIntrinsicElements;

    /**
     * Props accepted by every element and component, on top of their own.
     */
    export type IntrinsicAttributes = {
        /**
         * Identifies the element within a list.
         */
        key?: string | number
    };

    /**
     * Tells typescript that nested content arrives in the `children` prop. Only the property name is
     * read, the type is irrelevant.
     */
    export type ElementChildrenAttribute = {
        /**
         * The prop nested content is passed in.
         */
        children: TsxChildren
    };
}

/**
 * Fails when tsx is compiled by typescript instead of by zibri-tsx.
 * @param at - The jsx factory that was called.
 * @throws Always.
 */
function notCompiled(at: string): never {
    throw new Error(
        `'${at}' was called at runtime, which means a .tsx file was compiled by typescript instead of `
        + 'by zibri-tsx. Route your template files through the zibri-tsx Vite plugin from \'zibri-tsx/vite\', for example:\n'
        + 'plugins: [zibriTsx({ templateDirs: [path.resolve(\'src\', \'templates\')], vendorOutDir: path.resolve(\'assets\', \'public\', \'vendor\') })]'
    );
}

/**
 * Placeholder for the single child jsx factory. Zibri-tsx compiles jsx straight to html building
 * code, so this is never called in a correctly set up build.
 * @returns Never, it always throws.
 */
export function jsx(): never {
    return notCompiled('jsx');
}

/**
 * Placeholder for the multi child jsx factory. Zibri-tsx compiles jsx straight to html building
 * code, so this is never called in a correctly set up build.
 * @returns Never, it always throws.
 */
// cspell:disable-next-line
export function jsxs(): never {
    // cspell:disable-next-line
    return notCompiled('jsxs');
}

/**
 * Placeholder for the fragment marker. Zibri-tsx lowers fragments at compile time, so this is never
 * called in a correctly set up build.
 * @returns Never, it always throws.
 */
export function Fragment(): never {
    return notCompiled('Fragment');
}