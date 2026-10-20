import { InternalError } from '../error-handling/internal-error.model.ts';

/**
 * Definition of a typescript import.
 */
export type TsImportDefinition = {
    /**
     * The element that should be imported.
     */
    element: string,
    /**
     * The path of where to import from.
     */
    path: string,
    /**
     * Wether or not the element should be a default import.
     */
    defaultImport: boolean
};

/**
 * Adds the given import to the given typescript file lines.
 * @param lines - The lines of the typescript file to add the import to.
 * @param imp - The import that should be added.
 */
export function addImportStatement(lines: string[], imp: TsImportDefinition): void {
    if (lines.find(l => l.includes('import ') && l.includes(imp.path) && l.includes(imp.element))) {
        return;
    }
    const existingImport: string | undefined = lines.find(l => l.includes('import ') && l.includes(imp.path));
    if (!existingImport) {
        lines.unshift(getNewImportStatement(imp));
        return;
    }
    lines[lines.indexOf(existingImport)] = getUpdatedImportStatement(existingImport, imp);
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
function getNewImportStatement(imp: TsImportDefinition): string {
    return imp.defaultImport
        ? `import ${imp.element} from '${imp.path}';`
        : `import { ${imp.element} } from '${imp.path}';`;
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
function getUpdatedImportStatement(existingImport: string, imp: TsImportDefinition): string {
    if (imp.defaultImport && !existingImport.includes('{')) {
        throw new InternalError(`There is already a default import from ${imp.path}`);
    }
    if (imp.defaultImport) {
        return existingImport.replace('{', `${imp.element}, {`);
    }
    if (existingImport.includes('{')) {
        return existingImport.replace('import {', `import { ${imp.element},`);
    }
    // the line reached here by containing `import ` and the path, which also matches a side effect
    // import and a comment. Neither has a default element to put the named one beside, and rewriting
    // one silently returns it unchanged - so the import is missing from a file nobody looks at until
    // it fails to compile.
    const fromIndex: number = existingImport.indexOf(' from ');
    if (fromIndex === -1) {
        throw new InternalError(`Cannot add the import "${imp.element}" to "${existingImport.trim()}", which has no "from" clause`);
    }
    const defaultElement: string = existingImport.slice(0, fromIndex).replace('import ', '');
    return existingImport.replace(`import ${defaultElement} from `, `import ${defaultElement}, { ${imp.element} } from `);
}