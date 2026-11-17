import path from 'node:path';

import type { JSONOutput } from 'typedoc' with { 'resolution-mode': 'import' };
import { DocsUtilities } from 'zibri';

import { MovedPage } from './moved-page.model';
import { API_FOLDER, ApiReferenceUtilities } from '../api/api-reference.utilities';
import { REFLECTION_KINDS } from '../api/reflection-kinds';
import { BASE_PATH } from '../base-path';
import { DOCS_SITE } from '../navigation/docs-site';

// 3.0 published every page at documents/<name>.html, and every export at a page of typedoc, and the READMEs and
// changelogs on npm link there. Each of those addresses gets a page that sends the reader on to where the page is now,
// with the heading or member the link names.

// the folder typedoc gave the page of each kind of export
const TYPEDOC_FOLDERS: ReadonlyMap<number, string> = new Map<number, string>([
    [REFLECTION_KINDS.Class, 'classes'],
    [REFLECTION_KINDS.Interface, 'interfaces'],
    [REFLECTION_KINDS.TypeAlias, 'types'],
    [REFLECTION_KINDS.Function, 'functions'],
    [REFLECTION_KINDS.Variable, 'variables'],
    [REFLECTION_KINDS.Enum, 'enums'],
    [REFLECTION_KINDS.Namespace, 'modules']
]);

/**
 * Writes the pages that send a reader from an address of an earlier release on.
 */
export abstract class RedirectUtilities {
    /**
     * Every address 3.0 gave a page or an export, with where it is now: `documents/` and the name of the file of a page,
     * and the page typedoc wrote for an export or a member of a namespace, such as `classes/MarkdownService.html`.
     * @returns The moved pages.
     * @throws When two pages share a name, which 3.0 published at one address.
     */
    static resolveMovedPages(): MovedPage[] {
        const moved: MovedPage[] = [
            ...DocsUtilities.resolvePages(DOCS_SITE).map(page => ({
                from: `documents/${path.posix.basename(page.file, '.md')}.html`,
                to: DocsUtilities.resolveAddress(DOCS_SITE, page.file)
            })),
            ...this.resolveMovedApiPages()
        ];
        const shared: string[] = moved.map(page => page.from).filter((from, index, all) => all.indexOf(from) !== index);
        if (shared.length > 0) {
            throw new Error(`Two pages share the address 3.0 published one of them at: ${shared.join(', ')}.`);
        }
        return moved;
    }

    /**
     * A page sending the reader on, the heading its address names included.
     * @param to - Where the page is now.
     * @returns The html.
     */
    static resolveRedirectPage(to: string): string {
        return [
            '<!DOCTYPE html>',
            '<html lang="en">',
            '<head>',
            '<meta charset="utf-8">',
            `<title>${to}</title>`,
            `<link rel="canonical" href="${to}">`,
            // the script keeps the heading a link names, which the refresh drops
            `<script>location.replace(${JSON.stringify(to)} + location.hash);</script>`,
            `<meta http-equiv="refresh" content="0; url=${to}">`,
            '</head>',
            `<body><a href="${to}">${to}</a></body>`,
            '</html>',
            ''
        ].join('\n');
    }

    // the page typedoc wrote for each export, and for each member of a namespace, which it named after both
    private static resolveMovedApiPages(): MovedPage[] {
        // typedoc kept two names differing only in case apart, as a file system may not: the later one got a number
        const taken: Set<string> = new Set();
        const moved: MovedPage[] = [{ from: 'hierarchy.html', to: `${BASE_PATH}/${API_FOLDER}/` }];
        const add: (reflection: JSONOutput.DeclarationReflection, name: string, to: string) => void = (reflection, name, to) => {
            const folder: string | undefined = TYPEDOC_FOLDERS.get(reflection.kind);
            if (folder == undefined) {
                return;
            }
            const base: string = `${folder}/${name.replaceAll(/[^\w.-]/g, '_')}`;
            let from: string = `${base}.html`;
            for (let number: number = 1; taken.has(from.toLowerCase()); number++) {
                from = `${base}-${number}.html`;
            }
            taken.add(from.toLowerCase());
            moved.push({ from, to });
        };
        for (const declaration of ApiReferenceUtilities.resolveDeclarations()) {
            const to: string = ApiReferenceUtilities.resolveAddress(declaration.name);
            add(declaration, declaration.name, to);
            if (declaration.kind === REFLECTION_KINDS.Namespace) {
                for (const member of declaration.children ?? []) {
                    add(member, `${declaration.name}.${member.name}`, `${to}#${ApiReferenceUtilities.resolveMemberAnchor(member.name)}`);
                }
            }
        }
        return moved;
    }
}