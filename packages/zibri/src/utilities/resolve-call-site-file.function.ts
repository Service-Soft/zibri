import { fileURLToPath } from 'node:url';

/**
 * Resolves the file a stack frame belongs to.
 * @param callSite - The frame.
 * @returns The path of the file, or undefined when the frame names none.
 */
export function resolveCallSiteFile(callSite: NodeJS.CallSite): string | undefined {
    const fileName: string | undefined = callSite.getFileName() ?? undefined;
    // the frames of an es module name their file by its url, those of a commonjs module by its path
    return fileName?.startsWith('file://') === true ? fileURLToPath(fileName) : fileName;
}
