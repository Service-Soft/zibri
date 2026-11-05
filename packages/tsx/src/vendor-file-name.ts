/**
 * Maps a package name to the file name its vendor bundle is written to (and served under).
 *
 * Shared between the build, which writes the file, and the render path, which points a page at it -
 * so it lives on its own rather than beside the code that reads template source. A running
 * application needs this name and has no reason to load a parser to get it.
 * @param packageName - The package name, e.g. `chart.js` or `@scope/pkg`.
 * @returns The bundle file name, e.g. `chart-js.js`.
 */
export function vendorFileName(packageName: string): string {
    const kebab: string = packageName
        .replaceAll(/[^\da-z]+/gi, '-')
        .replaceAll(/([\da-z])([A-Z])/g, '$1-$2')
        .toLowerCase()
        .replaceAll(/^-+|-+$/g, '');
    return `${kebab}.js`;
}