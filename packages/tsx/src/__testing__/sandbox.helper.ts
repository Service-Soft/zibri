import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Recursively collects all `.tsx` file paths under a directory.
 * @param dir - The directory to scan.
 * @returns The absolute paths of every `.tsx` file found.
 */
export function collectTsxFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full: string = join(dir, entry);
        if (statSync(full).isDirectory()) {
            out.push(...collectTsxFiles(full));
        }
        else if (entry.endsWith('.tsx')) {
            out.push(full);
        }
    }
    return out;
}

/**
 * The name of a template: its path below the templates folder, separated by "/" on every platform.
 * @param templatesDir - The templates folder.
 * @param file - The absolute path of the template.
 * @returns The name, such as `pages/metrics/network-chart.tsx`.
 */
export function resolveTemplateName(templatesDir: string, file: string): string {
    // split on the platform's separator: a windows path holds no "/" to split on
    return relative(templatesDir, file).split(sep)
        .join('/');
}