import handlebars, { ParseOptions } from 'handlebars';

import { AstProgram } from './ast.model';
import { FsUtilities, FsPath } from '../utilities/fs.utilities';
import { MaskUtilities } from '../utilities/mask.utilities';
import { toCamelCase } from '../utilities/to-camel-case.function';

/**
 * Utilities for handling handlebar templates.
 */
export abstract class HandlebarUtilities {
    private static H: typeof Handlebars;

    /**
     * Initializes the handlebar utilities.
     * @param H - The external handlebar object. Is needed so helpers can be registered both inside and outside of Zibri.
     * @param componentsDir - The directory where components reside.
     */
    static async init(H: typeof Handlebars, componentsDir: string): Promise<void> {
        this.H = H;
        this.registerHelper('json', (context) => JSON.stringify(context));
        this.registerHelper('concat', (...args: unknown[]) => {
            args.pop();
            return args.join('');
        });
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
            return new handlebars.SafeString(MaskUtilities.mask(value));
        });

        const files: FsPath[] = await FsUtilities.glob(FsUtilities.getPath(componentsDir, '*.hbs'));
        for (const file of files) {
            const src: string = await FsUtilities.readFile(file);
            const base: string = FsUtilities.baseName(file).split('.hbs')[0];
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
        if (typeof this.H.compile !== 'function') {
            return handlebars.compile(input, options);
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
        return handlebars.parse(input, options) as AstProgram;
    }

    private static registerHelper(name: string, fn: Handlebars.HelperDelegate): void {
        handlebars.registerHelper(name, fn);
        this.H.registerHelper(name, fn);
    }

    private static registerPartial(name: string, template: string): void {
        let compiledFn: HandlebarsTemplateDelegate;

        // 1) If injected instance has a compiler, prefer it (keeps compile + runtime identical)
        if (typeof this.H.compile === 'function') {
            compiledFn = this.H.compile(template);
        }
        else {
            // 2) Injected runtime is probably runtime-only. Create a template function that runtime understands:
            //    a) precompile with local full compiler -> returns a JS string for the templateSpec
            //    b) evaluate that spec to an object and call this.H.template(spec) to get a function
            if (typeof this.H.template !== 'function') {
                // Unexpected: fallback to local compile (best-effort)
                compiledFn = handlebars.compile(template);
            }
            else {
                // Precompile to a template spec text
                const specSource: TemplateSpecification = handlebars.precompile(template);
                // specSource is JS source that evaluates to the templateSpec object.
                // Convert it into an object by evaluating it in a safe local function scope.
                // This uses `new Function` which is the same approach Handlebars' CLI/runtime uses.
                // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/no-implied-eval, typescript/no-unsafe-call, typescript/no-base-to-string
                const specObj: TemplateSpecification = new Function(`return (${specSource})`)();
                // Now produce a runtime function using the injected runtime
                compiledFn = this.H.template(specObj);
            }
        }

        handlebars.registerPartial(name, compiledFn);
        this.H.registerPartial(name, compiledFn);
    }
}