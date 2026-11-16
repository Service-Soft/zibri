import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { MarkdownCompilerUtilities } from '../markdown/markdown-compiler';
import { collectClientPackagesFromSource } from '../semantics/client-packages';

/**
 * Recursively finds the template files that can import a package under the given directories: the `.tsx` and the
 * `.mdx` ones, skipping tests. A `.md` template has no imports.
 * @param dirs - Directories to scan. Missing directories are ignored.
 * @returns The absolute template file paths.
 */
export function findTemplateFiles(dirs: string[]): string[] {
    const out: string[] = [];
    for (const dir of dirs) {
        collectInto(dir, out);
    }
    return out;
}

/**
 * Scans one directory tree for template files.
 * @param dir - The directory to scan.
 * @param out - The accumulator.
 */
function collectInto(dir: string, out: string[]): void {
    let entries: string[];
    try {
        entries = readdirSync(dir);
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const full: string = join(dir, entry);
        if (statSync(full).isDirectory()) {
            collectInto(full, out);
        }
        else if ((entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) || entry.endsWith('.mdx')) {
            out.push(full);
        }
    }
}

/**
 * Collects the union of `?client` packages across the given template files, in first-seen order.
 * @param files - Template file paths.
 * @returns The de-duplicated package names.
 */
export function collectClientPackagesFromFiles(files: string[]): string[] {
    const packages: string[] = [];
    for (const file of files) {
        const source: string = readFileSync(file, 'utf8');
        // an mdx template imports like the tsx template it is printed as. One that cannot be printed imports nothing,
        // and its build reports why
        const template: string = file.endsWith('.mdx')
            ? MarkdownCompilerUtilities.resolveMarkdownTemplate(source, 'mdx', file).tsx ?? ''
            : source;
        for (const packageName of collectClientPackagesFromSource(template)) {
            if (!packages.includes(packageName)) {
                packages.push(packageName);
            }
        }
    }
    return packages;
}