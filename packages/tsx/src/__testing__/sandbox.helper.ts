import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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