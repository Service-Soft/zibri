import { diffStringsUnified } from 'jest-diff';

/**
 * Heuristic for whether a buffer holds text: binary files (images, .ico, ...) almost always
 * contain a null byte somewhere, real text files never do.
 * @param buffer - The buffer to check.
 * @returns Whether the buffer is likely to hold text content.
 */
function isProbablyText(buffer: Buffer): boolean {
    return !buffer.includes(0);
}

/**
 * Compares two file contents and returns a stable, human-readable description of the difference.
 * Returns an empty string when the contents are identical, so it can be used directly in a
 * "diff === accepted difference" assertion.
 * @param generated - The content produced by the cli generator.
 * @param sandbox - The corresponding content inside packages/sandbox.
 * @returns An empty string when equal, otherwise a unified diff (or a note for binary files).
 */
export function diffFileContents(generated: Buffer, sandbox: Buffer): string {
    if (generated.equals(sandbox)) {
        return '';
    }
    if (!isProbablyText(generated) || !isProbablyText(sandbox)) {
        return `binary content differs (generated: ${generated.length} bytes, sandbox: ${sandbox.length} bytes)`;
    }
    return diffStringsUnified(
        generated.toString('utf8'),
        sandbox.toString('utf8'),
        { aAnnotation: 'generated', bAnnotation: 'sandbox' }
    ) ?? '';
}