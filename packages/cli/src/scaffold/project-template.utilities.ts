import { FsUtilities } from '../encapsulation';
import { getPath, Path } from '../utilities';

/**
 * What a template of a project file is rendered with: a text for each `{{name}}` in it, or a function
 * answering a new one for each, and a flag for each section.
 */
export type ProjectTemplateValues = Record<string, string | boolean | (() => string)>;

/**
 * What every template of a project file ends in.
 */
// it keeps the compiler, the test runner, the linter and npm from taking a template for a file of
// this package: a ".gitignore" would be dropped from it when it is published, and a ".test.ts" would
// run as one of its tests
const TEMPLATE_SUFFIX: string = '.tpl';

/**
 * Where the templates are: a copy of a generated project, every file of it a template.
 */
const TEMPLATES_PATH: Path = getPath(__dirname, '..', '..', 'project');

/**
 * A comment alone on its lines, which go with it.
 */
const LINE_COMMENT: RegExp = /^[\t ]*{{![\S\s]*?}}\n/gm;

/**
 * A comment inside a line.
 */
const INLINE_COMMENT: RegExp = /{{![\S\s]*?}}/g;

/**
 * A section alone on its lines: `{{#flag}}` or `{{^flag}}`, the lines it holds, and `{{/flag}}`. The
 * lines of the markers go with them.
 */
const LINE_SECTION: RegExp = /^[\t ]*{{([#^])(\w+)}}\n([\S\s]*?)^[\t ]*{{\/\2}}\n/gm;

/**
 * A section inside a line.
 */
const INLINE_SECTION: RegExp = /{{([#^])(\w+)}}([\S\s]*?){{\/\2}}/g;

/**
 * A value.
 */
const VALUE: RegExp = /{{(\w+)}}/g;

/**
 * A marker no value or section consumed.
 */
const LEFT_OVER_MARKER: RegExp = /{{[#/^]?\w+}}/;

/**
 * The templates the files of a generated project are rendered from.
 *
 * `{{name}}` is replaced by a value, `{{#flag}}…{{/flag}}` is kept when the flag is set and
 * `{{^flag}}…{{/flag}}` when it is not, and `{{! … }}` is left out: why a template is as it is, for
 * whoever changes it. A section or a comment alone on its lines takes those lines with it.
 */
export abstract class ProjectTemplateUtilities {
    /**
     * Finds every file a project is rendered into.
     * @returns The path of each, relative to the project and separated by "/".
     */
    static async findFilePaths(): Promise<string[]> {
        return (await FsUtilities.findFiles(TEMPLATES_PATH))
            .filter(relativePath => relativePath.endsWith(TEMPLATE_SUFFIX))
            .map(relativePath => relativePath.slice(0, -TEMPLATE_SUFFIX.length))
            .sort((a, b) => a.localeCompare(b, 'en'));
    }

    /**
     * Reads the template of a file, as it is before rendering.
     * @param relativePath - The file, relative to the project.
     * @returns The template.
     */
    static async readTemplate(relativePath: string): Promise<string> {
        return await FsUtilities.readFile(getPath(TEMPLATES_PATH, `${relativePath}${TEMPLATE_SUFFIX}`));
    }

    /**
     * Renders a file of a project.
     * @param relativePath - The file, relative to the project.
     * @param values - What its template is rendered with.
     * @returns What the file holds.
     * @throws When the template names a value or a flag the values do not have.
     */
    static async resolveFile(relativePath: string, values: ProjectTemplateValues): Promise<string> {
        return this.render(relativePath, await this.readTemplate(relativePath), values);
    }

    private static render(relativePath: string, template: string, values: ProjectTemplateValues): string {
        const keepSection: (marker: string, kind: string, flag: string, content: string) => string = (_, kind, flag, content) => {
            return this.resolveFlag(relativePath, values, flag) === (kind === '#') ? content : '';
        };
        const rendered: string = template
            .replaceAll(LINE_COMMENT, '')
            .replaceAll(INLINE_COMMENT, '')
            .replaceAll(LINE_SECTION, keepSection)
            .replaceAll(INLINE_SECTION, keepSection)
            .replaceAll(VALUE, (_, key: string) => this.resolveValue(relativePath, values, key));
        const leftOver: string | undefined = LEFT_OVER_MARKER.exec(rendered)?.[0];
        if (leftOver != undefined) {
            throw new Error(`The template of "${relativePath}" holds "${leftOver}", which opens or closes no section.`);
        }
        return rendered;
    }

    private static resolveFlag(relativePath: string, values: ProjectTemplateValues, flag: string): boolean {
        const value: string | boolean | (() => string) | undefined = values[flag];
        if (typeof value !== 'boolean') {
            throw new Error(`The template of "${relativePath}" has a section "${flag}", which is no flag it is rendered with.`);
        }
        return value;
    }

    private static resolveValue(relativePath: string, values: ProjectTemplateValues, key: string): string {
        const value: string | boolean | (() => string) | undefined = values[key];
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value === 'function') {
            return value();
        }
        throw new Error(`The template of "${relativePath}" names "${key}", which is no value it is rendered with.`);
    }
}