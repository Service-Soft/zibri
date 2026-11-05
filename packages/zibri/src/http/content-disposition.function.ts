/**
 * How a browser treats a file it is answered with: saved as a download, or shown.
 */
export type ContentDisposition = 'attachment' | 'inline';

/**
 * Writes the `Content-Disposition` header of a file (RFC 6266).
 *
 * The plain `filename` is read by every client and holds ASCII only, so a name outside it gets the
 * closest ASCII spelling there, and itself in UTF-8 as `filename*`, which every current browser
 * prefers. A plain `filename` is never percent-decoded, so writing the encoded form there saved
 * `Rechnung März.pdf` as `Rechnung%20M%C3%A4rz.pdf`.
 * @param disposition - Whether the file is a download or shown.
 * @param filename - The name of the file.
 * @returns The header.
 */
export function resolveContentDisposition(disposition: ContentDisposition, filename: string): string {
    const ascii: string = filename
        .normalize('NFD')
        // the accents a letter was written with, which leave the letter in ASCII
        .replaceAll(/[\u0300-\u036F]/g, '')
        .replaceAll(/[^\u0020-\u007E]/g, '_');
    const escaped: string = ascii.replaceAll(/["\\]/g, c => `\\${c}`);
    const quoted: string = `"${escaped}"`;
    if (ascii === filename) {
        return `${disposition}; filename=${quoted}`;
    }
    // what encodeURIComponent leaves as it is and RFC 8187 does not allow in a value
    const encoded: string = encodeURIComponent(filename).replaceAll(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)
        .toUpperCase()}`);
    return `${disposition}; filename=${quoted}; filename*=UTF-8''${encoded}`;
}