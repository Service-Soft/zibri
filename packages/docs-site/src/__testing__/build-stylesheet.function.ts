import { execFileSync } from 'node:child_process';
import path from 'node:path';

const PROJECT_ROOT: string = path.join(__dirname, '..', '..');

/**
 * Builds the stylesheet the way the build does, with Tailwind through postcss, so a page a test opens is laid out as it
 * is on the site. The assets folder holds only its source.
 *
 * In a process of its own, because Tailwind and what it loads ship as es modules, which jest cannot require.
 * @returns The stylesheet the pages are served with.
 */
export function buildStylesheet(): string {
    const script: string = [
        'import { readFileSync } from \'node:fs\';',
        'import postcss from \'postcss\';',
        'import tailwind from \'@tailwindcss/postcss\';',
        'const from = process.argv[1];',
        'const result = await postcss([tailwind()]).process(readFileSync(from, \'utf8\'), { from });',
        'process.stdout.write(result.css);'
    ].join('\n');
    return execFileSync(
        process.execPath,
        ['--input-type=module', '--eval', script, path.join(PROJECT_ROOT, 'assets', 'public', 'style.css')],
        { cwd: PROJECT_ROOT, encoding: 'utf8' }
    );
}