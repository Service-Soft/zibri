import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { SourceImport } from './source-import.model';

const srcDir: string = path.resolve(__dirname, '..');

/**
 * The directories a walk does not go into: what a package installed, and what a running suite writes
 * and removes again, which a walk beside it would find half gone.
 */
const SKIPPED_DIRECTORIES: Set<string> = new Set(['node_modules', 'file-output']);

/**
 * Reads which files the sources of the framework import, to check which way its subsystems depend on
 * each other.
 */
export abstract class SourceImportUtilities {
    /**
     * Finds the sources under a directory, leaving out tests and what only tests use.
     * @param dir - The directory, relative to `src`.
     * @returns The files, relative to `src`.
     */
    static findSourceFiles(dir: string): string[] {
        return this.findFiles(srcDir, dir, file => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.cases.ts'));
    }

    /**
     * Finds the files under a directory, outside of what a package installed or a suite writes.
     * @param root - What the directory and the files are relative to.
     * @param dir - The directory.
     * @param include - Whether a file is one to find.
     * @returns The files, relative to the root.
     */
    static findFiles(root: string, dir: string, include: (file: string) => boolean): string[] {
        const res: string[] = [];
        for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
            const file: string = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIPPED_DIRECTORIES.has(entry.name)) {
                    res.push(...this.findFiles(root, file, include));
                }
            }
            else if (include(file)) {
                res.push(file);
            }
        }
        return res;
    }

    /**
     * Reads a source file.
     * @param file - The file, relative to `src`.
     * @returns Its text.
     */
    static readSourceFile(file: string): string {
        return readFileSync(path.join(srcDir, file), 'utf8');
    }

    /**
     * Reads the imports of the sources under a directory.
     * @param dir - The directory, relative to `src`.
     * @returns Each import of a relative path, resolved against `src`.
     */
    static findSourceImports(dir: string): SourceImport[] {
        return this.findSourceFiles(dir).flatMap(file => this.findFileImports(file));
    }

    /**
     * Reads the imports of one source file.
     * @param file - The file, relative to `src`.
     * @returns Each import of a relative path, resolved against `src`.
     */
    static findFileImports(file: string): SourceImport[] {
        return [
            ...this.readSourceFile(file)
                .matchAll(/^import (?:(type )?([^;]*?) from )?'(\.[^']+)';/gm)
        ]
            .map(([, typeKeyword, clause, specifier = '']) => ({
                file,
                imported: path.relative(srcDir, path.resolve(srcDir, path.dirname(file), specifier)),
                isTypeOnly: typeKeyword != undefined || (clause != undefined && this.isTypeOnlyClause(clause))
            }));
    }

    /**
     * Finds the runtime imports of the sources under some directories that reach directories outside
     * the given ones.
     * @param dirs - The importing directories, relative to `src`.
     * @param allowed - The top level directories they may import at runtime.
     * @returns Each such import, as `file -> imported`.
     */
    static findRuntimeImportsOutside(dirs: string[], allowed: string[]): string[] {
        return dirs.flatMap(dir => this.findSourceImports(dir))
            .filter(i => !i.isTypeOnly && !allowed.includes(this.findTopLevelDir(i.imported)))
            .map(i => `${i.file} -> ${i.imported}`);
    }

    /**
     * Finds the top level directory a file is in.
     * @param file - The file, relative to `src`.
     * @returns The directory.
     */
    static findTopLevelDir(file: string): string {
        return file.split(path.sep)[0] ?? file;
    }

    /**
     * Whether the names an import brings in are each marked `type`, such as `{ type A, type B }`.
     * @param clause - What stands between `import` and `from`.
     * @returns True when every name is a type.
     */
    private static isTypeOnlyClause(clause: string): boolean {
        const trimmed: string = clause.trim();
        if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
            return false;
        }
        return trimmed.slice(1, -1).split(',')
            .map(name => name.trim())
            .filter(name => name.length)
            .every(name => name.startsWith('type '));
    }
}