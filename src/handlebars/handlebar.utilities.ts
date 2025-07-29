import handlebars from 'handlebars';

import { TreeNode } from '../assets';

/**
 * Utilities for handling handlebar templates.
 */
export abstract class HandlebarUtilities {
    private static H: typeof Handlebars;

    /**
     * Initializes the handlebar utilities.
     * @param H - The external handlebar object. Is needed so helpers can be registered both inside and outside of Zibri.
     */
    static init(H: typeof Handlebars): void {
        this.H = H;
        this.registerHelper('json', (context) => JSON.stringify(context));
        // eslint-disable-next-line typescript/no-unsafe-return
        this.registerHelper('??', (a, b) => a ?? b);
        this.registerHelper('and',
            // args = [a, b, ..., options]
            (...args) => {
                // eslint-disable-next-line typescript/no-unsafe-assignment, jsdoc/require-jsdoc
                const opts: { fn?: Function, inverse: Function, data: { root: unknown } } = args.pop();
                if (opts.fn == undefined) {
                    return args.every(Boolean);
                }
                // eslint-disable-next-line typescript/no-unsafe-return, typescript/no-unsafe-call
                return args.every(Boolean) ? opts.fn(opts.data.root) : opts.inverse(opts.data.root);
            });
        this.registerHelper('mask', (value: unknown) => {
            if (typeof value !== 'string') {
                return '';
            }
            return new handlebars.SafeString(mask(value));
        });
        this.registerHelper(
            'renderTree',
            function(
                this: handlebars.HelperOptions, // ← explicitly type `this`
                nodes: TreeNode[]
            ): handlebars.SafeString {
                let out: string = '';
                for (const node of nodes) {
                    if (node.type === 'directory') {
                        out += `<details><summary>${handlebars.escapeExpression(node.name)
                        }</summary>`;
                        // 2) Call the helper recursively using `apply` so `this` stays typed
                        out += (handlebars.helpers.renderTree as Function).apply(this, [node.children]);
                        out += '</details>';
                    }
                    else {
                        out += `<a class="file-link" href="${handlebars.escapeExpression(node.route)
                        }">${handlebars.escapeExpression(node.name)}</a>`;
                    }
                }
                return new handlebars.SafeString(out);
            }
        );
    }

    private static registerHelper(name: string, fn: Handlebars.HelperDelegate): void {
        handlebars.registerHelper(name, fn);
        this.H.registerHelper(name, fn);
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function mask(input: string): string {
    if (input.length <= 3) {
        return input;
    }
    const starsCount: number = input.length - 3;
    return input[0] + '*'.repeat(starsCount) + input.slice(-2);
}