import type { ParseOptions } from 'handlebars';

import { AstProgram } from './ast.model.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { FsUtilities, FsPath } from '../utilities/fs.utilities.ts';
import { JsonUtilities } from '../utilities/json.utilities.ts';
import { MaskUtilities } from '../utilities/mask.utilities.ts';
import { hasOptionalPeer, optionalPeer } from '../utilities/optional-peer.function.ts';
import { toCamelCase } from '../utilities/to-camel-case.function.ts';

/**
 * Options for configuring things about handlebars.
 */
export type HandlebarOptions = {
    /**
     * The external handlebar object. Is needed so helpers can be registered both inside and outside of Zibri.
     */
    H?: typeof Handlebars,
    /**
     * The directory where components reside.
     */
    componentsDir?: string
};

/**
 * Utilities for handling handlebar templates.
 */
export abstract class HandlebarUtilities {
    private static H: typeof Handlebars | undefined;

    /**
     * The full compiler, loaded the first time anything actually needs one.
     * @returns Handlebars itself.
     */
    private static compiler(): typeof Handlebars {
        return optionalPeer<typeof Handlebars>('handlebars', 'Rendering a handlebars template');
    }

    /**
     * Initializes the handlebar utilities.
     *
     * Runs for every application, whether or not it has a single template, so a missing handlebars
     * is not something this can refuse over - there is simply nothing to register helpers and
     * partials on. Anything that then goes on to ask for a template says which package is missing.
     * A consumer who passed their own `H` has said they intend to use templating, so that case is
     * held to the installed package rather than skipped.
     */
    static async init(): Promise<void> {
        const options: HandlebarOptions = inject(ZIBRI_DI_TOKENS.HANDLEBAR_OPTIONS);
        if (options.H == undefined && !hasOptionalPeer('handlebars')) {
            return;
        }
        this.H = options.H ?? optionalPeer<typeof Handlebars>('handlebars/runtime', 'Rendering a handlebars template');
        this.registerHelper('json', (context) => JsonUtilities.stringify(context));
        this.registerHelper('concat', (...args: unknown[]) => {
            args.pop();
            return args.join('');
        });
        // eslint-disable-next-line typescript/no-unsafe-return
        this.registerHelper('??', (a, b) => a ?? b);
        this.registerHelper('and',
            // args = [a, b, ..., options]. A function rather than an arrow, because `this` is the context
            // the block is used in - inside an each, the item - and the block renders against it
            function(this: unknown, ...args: unknown[]) {
                // eslint-disable-next-line jsdoc-js/require-jsdoc
                const opts: { fn?: Function, inverse: Function } = args.pop() as { fn?: Function, inverse: Function };
                if (opts.fn == undefined) {
                    return args.every(Boolean);
                }
                // eslint-disable-next-line typescript/no-unsafe-return, typescript/no-unsafe-call
                return args.every(Boolean) ? opts.fn(this) : opts.inverse(this);
            });
        this.registerHelper('mask', (value: unknown) => {
            if (typeof value !== 'string') {
                return '';
            }
            // a plain string, which `{{ }}` escapes: what the mask keeps of the value is the value's own
            return MaskUtilities.mask(value);
        });

        const componentsDir: string = options.componentsDir
            ?? FsUtilities.getPath(inject(ZIBRI_DI_TOKENS.ASSET_SERVICE).assetsPath, 'templates', 'components');
        const files: FsPath[] = await FsUtilities.glob(FsUtilities.getPath(componentsDir, '*.hbs'));
        for (const file of files) {
            const src: string = await FsUtilities.readFile(file);
            const fileName: string = FsUtilities.baseName(file);
            const base: string = fileName.split('.hbs')[0] ?? fileName;
            const partialName: string = toCamelCase(base);
            this.registerPartial(partialName, src);
        }
    }

    /**
     * Compiles the given handlebars string.
     * @param input - The handlebars template in form of a string.
     * @param options - Additional options for compilation.
     * @returns The compiled template function.
     */
    static render<T>(input: string, options?: CompileOptions): HandlebarsTemplateDelegate<T> {
        if (typeof this.H?.compile !== 'function') {
            return this.compiler().compile(input, options);
        }
        return this.H.compile(input, options);
    }

    /**
     * Renders the template at the given path with the given data.
     * @param path - The path of the handlebars template file.
     * @param data - The data to fill into the template.
     * @returns The rendered html string.
     */
    static async renderTemplate<T extends Record<string, unknown>>(path: `${FsPath}.hbs`, data: T): Promise<string> {
        const source: string = await FsUtilities.readFile(path as FsPath);
        return this.renderTemplateString(source, data);
    }

    /**
     * Renders the given handlebars template string as html, using the provided data as variables.
     * @param templateString - The handlebars template string.
     * @param data - The data to use inside the template.
     * @returns The rendered html content.
     */
    static renderTemplateString<T extends Record<string, unknown>>(
        templateString: string,
        data: T
    ): string {
        const template: HandlebarsTemplateDelegate<T> = this.render(templateString);
        const html: string = template(data);
        return html;
    }

    /**
     * Parses the given handlebars string into an AST.
     * @param input - The handlebars template in form of a string.
     * @param options - Additional options for parsing the template.
     * @returns The abstract syntax tree of the template.
     */
    static parse(input: string, options?: ParseOptions): AstProgram {
        return this.compiler().parse(input, options) as AstProgram;
    }

    /**
     * The runtime `init` settled on, which is either the consumer's own or handlebars'.
     * @returns The runtime to register on.
     * @throws If `init` has not run, or skipped because handlebars is not installed.
     */
    private static get runtime(): typeof Handlebars {
        if (this.H == undefined) {
            throw new InternalError('The handlebar utilities were used before the application initialized them.');
        }
        return this.H;
    }

    private static registerHelper(name: string, fn: Handlebars.HelperDelegate): void {
        this.compiler().registerHelper(name, fn);
        this.runtime.registerHelper(name, fn);
    }

    private static registerPartial(name: string, template: string): void {
        let compiledFn: HandlebarsTemplateDelegate;

        // 1) If injected instance has a compiler, prefer it (keeps compile + runtime identical)
        if (typeof this.runtime.compile === 'function') {
            compiledFn = this.runtime.compile(template);
        }
        else {
            // 2) Injected runtime is probably runtime-only. Create a template function that runtime understands:
            //    a) precompile with local full compiler -> returns a JS string for the templateSpec
            //    b) evaluate that spec to an object and call this.H.template(spec) to get a function
            if (typeof this.runtime.template !== 'function') {
                // Unexpected: fallback to local compile (best-effort)
                compiledFn = this.compiler().compile(template);
            }
            else {
                // Precompile to a template spec text
                const specSource: TemplateSpecification = this.compiler().precompile(template);
                // specSource is JS source that evaluates to the templateSpec object.
                // Convert it into an object by evaluating it in a safe local function scope.
                // This uses `new Function` which is the same approach Handlebars' CLI/runtime uses.
                // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/no-implied-eval, typescript/no-unsafe-call, typescript/no-base-to-string typescript/restrict-template-expressions
                const specObj: TemplateSpecification = new Function(`return (${specSource})`)();
                // Now produce a runtime function using the injected runtime
                compiledFn = this.runtime.template(specObj);
            }
        }

        this.compiler().registerPartial(name, compiledFn);
        this.runtime.registerPartial(name, compiledFn);
    }
}