import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { collectClientPackagesFromSource } from '../semantics/client-packages.ts';

/**
 * Recursively finds the `.tsx` template files under the given directories, skipping tests.
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
        else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) {
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
        for (const packageName of collectClientPackagesFromSource(readFileSync(file, 'utf8'))) {
            if (!packages.includes(packageName)) {
                packages.push(packageName);
            }
        }
    }
    return packages;
}