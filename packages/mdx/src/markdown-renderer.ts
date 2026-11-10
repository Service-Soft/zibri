import type { Root } from 'mdast';
import type { MdxAlert, MdxComponents, Raw } from 'zibri-tsx';
import { isCompiledComponent, RenderServerRuntime, reportRenderMistake } from 'zibri-tsx/internal';

import { MarkdownPackages, MarkdownPackageUtilities } from './markdown-packages';
import { ALERT_TITLES, ConstructKind, ConstructProps, MarkdownConstruct, MarkdownTree, MarkdownTreeNode, MarkdownTreeUtilities } from './markdown-tree';

/**
 * Renders the content of a construct, when it has any.
 */
type RenderContent = (() => unknown) | undefined;

/**
 * Renders the plain element a construct renders when no component is chosen for it, the same element a `.md` page
 * renders, see `DEFAULT_COMPONENTS` of `markdown-printer.ts`.
 */
type RenderDefault = (props: ConstructProps, content: RenderContent, runtime: RenderServerRuntime) => unknown;

/**
 * The plain element of each construct.
 */
const DEFAULT_ELEMENTS: Record<ConstructKind, RenderDefault> = {
    heading: ({ tag, id }, content, runtime) => runtime.component(String(tag), { id }, content),
    paragraph: (_props, content, runtime) => runtime.component('p', {}, content),
    link: ({ href, title }, content, runtime) => runtime.component('a', { href, title }, content),
    image: ({ src, alt, title }, _content, runtime) => runtime.component('img', { src, alt, title }),
    emphasis: (_props, content, runtime) => runtime.component('em', {}, content),
    strong: (_props, content, runtime) => runtime.component('strong', {}, content),
    delete: (_props, content, runtime) => runtime.component('del', {}, content),
    inlineCode: (_props, content, runtime) => runtime.component('code', {}, content),
    codeBlock: ({ language }, content, runtime) => runtime.component('pre', {}, () => runtime.component(
        'code',
        { className: language === undefined ? undefined : `language-${String(language)}` },
        content
    )),
    blockquote: ({ alert }, content, runtime) => runtime.component('blockquote', {}, () => [
        isAlert(alert) && runtime.component('p', {}, () => runtime.component('strong', {}, () => ALERT_TITLES[alert])),
        content?.()
    ]),
    list: ({ ordered, start }, content, runtime) => ordered === true
        ? runtime.component('ol', { start }, content)
        : runtime.component('ul', {}, content),
    listItem: ({ checked }, content, runtime) => runtime.component('li', {}, () => [
        checked !== undefined && runtime.component('input', { type: 'checkbox', checked, disabled: true }),
        content?.()
    ]),
    table: (_props, content, runtime) => runtime.component('table', {}, content),
    tableHead: (_props, content, runtime) => runtime.component('thead', {}, content),
    tableBody: (_props, content, runtime) => runtime.component('tbody', {}, content),
    tableRow: (_props, content, runtime) => runtime.component('tr', {}, content),
    tableCell: ({ head, align }, content, runtime) => runtime.component(head === true ? 'th' : 'td', { align }, content),
    thematicBreak: (_props, _content, runtime) => runtime.component('hr', {})
};

/**
 * Renders markdown the server gets while it runs, such as from a database, in the page being rendered.
 */
export abstract class MarkdownRendererUtilities {
    /**
     * Renders markdown inside the render of a page: each construct renders the component chosen for it, or the element
     * a `.md` page renders for it, with the props a `.md` page hands it. The markdown is never compiled, and holds
     * nothing but markdown: html in it is a mistake only the render can see, which is left out.
     * @param source - The markdown.
     * @param components - The components its constructs render, which are compiled templates.
     * @param runtime - The runtime of the page being rendered.
     * @returns The html.
     * @throws When a component is no compiled template, or for html in `development`.
     */
    static renderMarkdown(source: string, components: MdxComponents, runtime: RenderServerRuntime): Raw {
        const packages: MarkdownPackages = MarkdownPackageUtilities.resolveMarkdownPackages();
        // plain markdown, which never fails to parse: what micromark cannot read as a construct is text
        const parsed: Root = MarkdownPackageUtilities.parseMarkdown(packages, source, 'md');
        const tree: MarkdownTree = MarkdownTreeUtilities.resolveMarkdownTree(parsed);
        return runtime.raw(runtime.child(new MarkdownRenderer(components, runtime).renderNodes(tree.nodes)));
    }
}

/**
 * Renders the tree of one piece of markdown.
 */
class MarkdownRenderer {
    constructor(private readonly components: MdxComponents, private readonly runtime: RenderServerRuntime) {}

    /**
     * Renders nodes of the tree.
     * @param nodes - The nodes.
     * @returns What each renders, for the runtime to write.
     */
    renderNodes(nodes: MarkdownTreeNode[]): unknown[] {
        return nodes.map(node => this.renderNode(node));
    }

    private renderNode(node: MarkdownTreeNode): unknown {
        switch (node.type) {
            case 'construct': {
                return this.renderConstruct(node);
            }
            case 'element': {
                const children: MarkdownTreeNode[] | undefined = node.children;
                return this.runtime.component(
                    node.tag,
                    { ...node.attributes },
                    children === undefined ? undefined : () => this.renderNodes(children)
                );
            }
            case 'text': {
                return node.value;
            }
            case 'html': {
                reportRenderMistake(
                    this.runtime.environment,
                    `The markdown holds the html '${node.node.value}', which markdown rendered at runtime does not hold. `
                    + 'Write it as markdown. It is left out.'
                );
                return undefined;
            }
            // what only a .md or .mdx template holds: the start of a line its source map leads to, and the code of mdx
            case 'line':
            case 'expression':
            case 'jsx': {
                return undefined;
            }
        }
    }

    private renderConstruct(node: MarkdownConstruct): unknown {
        const children: MarkdownTreeNode[] | undefined = node.children;
        const content: RenderContent = children === undefined ? undefined : () => this.renderNodes(children);
        const props: ConstructProps = withoutUndefined(node.props);
        const component: unknown = this.components[node.kind];
        if (component === undefined) {
            return DEFAULT_ELEMENTS[node.kind](props, content, this.runtime);
        }
        if (!isCompiledComponent(component)) {
            throw new Error(
                `The component of the markdown construct '${node.kind}' was not compiled by zibri-tsx. Name a component of `
                + 'a template, which the build compiles.'
            );
        }
        return this.runtime.component(component, props, content);
    }
}

/**
 * Whether the prop of a blockquote names a kind of alert.
 * @param value - The prop.
 * @returns True for a kind of alert.
 */
function isAlert(value: ConstructProps[string]): value is MdxAlert {
    return typeof value === 'string' && value in ALERT_TITLES;
}

/**
 * The props of a construct a value is given for, as a `.md` page hands them: one left out is not handed at all.
 * @param props - The props.
 * @returns Those with a value.
 */
function withoutUndefined(props: ConstructProps): ConstructProps {
    return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));
}