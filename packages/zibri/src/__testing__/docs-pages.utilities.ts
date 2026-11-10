import { readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * The folder the pages of zibri's documentation are in.
 */
export const DOCS_DIR: string = path.join(__dirname, '..', '..', 'docs');

/**
 * The pages of zibri's documentation, as the tests that check them read them. A page is named by
 * its path below `docs/`, with `/` between the folders.
 */
export abstract class DocsPagesUtilities {
    /**
     * Every page. Nothing of what typedoc generates into `docs/.generated`.
     * @returns The names of the pages.
     */
    static resolvePageNames(): string[] {
        return readdirSync(DOCS_DIR, { recursive: true, encoding: 'utf8' })
            .map(name => name.split(path.sep).join('/'))
            .filter(name => name.endsWith('.md') && !name.startsWith('.generated/'));
    }

    /**
     * The page a link names.
     * @param page - The name of the page the link is on.
     * @param target - Where the link points, relative to that page and without its anchor.
     * @returns The name of the linked page, starting with `..` when the link leaves `docs/`.
     */
    static resolveLinkedPage(page: string, target: string): string {
        return path.posix.join(path.posix.dirname(page), target);
    }
}