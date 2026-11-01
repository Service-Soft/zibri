/**
 * The size of the em square of a fake font.
 */
const UNITS_PER_EM: number = 1000;

/**
 * Builds a TrueType font that has a glyph for each of the given characters and for nothing else.
 *
 * Every glyph is the same box, so the font is good for nothing but telling which characters it was
 * asked to cover, which is what a test of font selection needs: a font in a script the default font
 * lacks, small and the same on every machine, with no license to carry. Readable by fontkit, and so
 * embeddable by pdfkit.
 * @param postscriptName - The name the font goes by, which a pdf embedding it names it as.
 * @param characters - The characters it has a glyph for.
 * @returns The font file.
 */
export function createFakeFont(postscriptName: string, characters: string): Buffer {
    const codePoints: number[] = [...new Set([...characters].map(c => c.codePointAt(0) ?? 0))].sort((a, b) => a - b);
    // glyph 0 is the one drawn for a character the font lacks, and is empty
    const glyphCount: number = codePoints.length + 1;
    const box: Buffer = boxGlyph();
    const glyf: Buffer = Buffer.concat(codePoints.map(() => box));
    const loca: Buffer = Buffer.alloc(4 * (glyphCount + 1));
    for (let glyph: number = 1; glyph <= glyphCount; glyph++) {
        loca.writeUInt32BE((glyph - 1) * box.length, 4 * glyph);
    }

    return assemble({
        cmap: cmapTable(codePoints),
        glyf,
        head: headTable(),
        hhea: hheaTable(glyphCount),
        hmtx: hmtxTable(glyphCount),
        loca,
        maxp: maxpTable(glyphCount),
        name: nameTable(postscriptName),
        post: postTable()
    });
}

/**
 * A box from (100, 0) to (900, 700): one contour of four points on the curve.
 * @returns The glyph, padded to four bytes.
 */
function boxGlyph(): Buffer {
    const glyph: Buffer = Buffer.alloc(36);
    let offset: number = glyph.writeInt16BE(1, 0);
    for (const bound of [100, 0, 900, 700]) {
        offset = glyph.writeInt16BE(bound, offset);
    }
    offset = glyph.writeUInt16BE(3, offset);
    offset = glyph.writeUInt16BE(0, offset);
    for (let point: number = 0; point < 4; point++) {
        offset = glyph.writeUInt8(0x01, offset);
    }
    for (const x of [100, 0, 800, 0]) {
        offset = glyph.writeInt16BE(x, offset);
    }
    for (const y of [0, 700, 0, -700]) {
        offset = glyph.writeInt16BE(y, offset);
    }
    return glyph;
}

/**
 * A character map of one format 12 subtable, each character its own group.
 * @param codePoints - The characters, ascending.
 * @returns The table.
 */
function cmapTable(codePoints: number[]): Buffer {
    const subtableLength: number = 16 + 12 * codePoints.length;
    const table: Buffer = Buffer.alloc(12 + subtableLength);
    table.writeUInt16BE(0, 0);
    table.writeUInt16BE(1, 2);
    // Windows, Unicode full repertoire
    table.writeUInt16BE(3, 4);
    table.writeUInt16BE(10, 6);
    table.writeUInt32BE(12, 8);
    table.writeUInt16BE(12, 12);
    table.writeUInt16BE(0, 14);
    table.writeUInt32BE(subtableLength, 16);
    table.writeUInt32BE(0, 20);
    table.writeUInt32BE(codePoints.length, 24);
    for (const [index, codePoint] of codePoints.entries()) {
        const offset: number = 28 + 12 * index;
        table.writeUInt32BE(codePoint, offset);
        table.writeUInt32BE(codePoint, offset + 4);
        table.writeUInt32BE(index + 1, offset + 8);
    }
    return table;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function headTable(): Buffer {
    const table: Buffer = Buffer.alloc(54);
    table.writeUInt32BE(0x0001_0000, 0);
    table.writeUInt32BE(0x0001_0000, 4);
    table.writeUInt32BE(0x5F0F_3CF5, 12);
    table.writeUInt16BE(0x000B, 16);
    table.writeUInt16BE(UNITS_PER_EM, 18);
    table.writeInt16BE(0, 36);
    table.writeInt16BE(0, 38);
    table.writeInt16BE(1000, 40);
    table.writeInt16BE(800, 42);
    table.writeUInt16BE(8, 46);
    table.writeInt16BE(2, 48);
    // long offsets in loca
    table.writeInt16BE(1, 50);
    return table;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function hheaTable(glyphCount: number): Buffer {
    const table: Buffer = Buffer.alloc(36);
    table.writeUInt32BE(0x0001_0000, 0);
    table.writeInt16BE(800, 4);
    table.writeInt16BE(-200, 6);
    table.writeUInt16BE(UNITS_PER_EM, 10);
    table.writeInt16BE(900, 16);
    table.writeInt16BE(1, 18);
    table.writeUInt16BE(glyphCount, 34);
    return table;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function hmtxTable(glyphCount: number): Buffer {
    const table: Buffer = Buffer.alloc(4 * glyphCount);
    for (let glyph: number = 0; glyph < glyphCount; glyph++) {
        table.writeUInt16BE(UNITS_PER_EM, 4 * glyph);
        table.writeInt16BE(glyph === 0 ? 0 : 100, 4 * glyph + 2);
    }
    return table;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function maxpTable(glyphCount: number): Buffer {
    const table: Buffer = Buffer.alloc(32);
    table.writeUInt32BE(0x0001_0000, 0);
    table.writeUInt16BE(glyphCount, 4);
    table.writeUInt16BE(4, 6);
    table.writeUInt16BE(1, 8);
    table.writeUInt16BE(2, 14);
    return table;
}

/**
 * The names of the font, in English for Windows.
 * @param postscriptName - Its PostScript name, which is its family and full name too.
 * @returns The table.
 */
function nameTable(postscriptName: string): Buffer {
    const names: [number, string][] = [[1, postscriptName], [2, 'Regular'], [4, postscriptName], [6, postscriptName]];
    const strings: Buffer[] = names.map(([, value]) => Buffer.from(value, 'utf16le').swap16());
    const header: Buffer = Buffer.alloc(6 + 12 * names.length);
    header.writeUInt16BE(0, 0);
    header.writeUInt16BE(names.length, 2);
    header.writeUInt16BE(header.length, 4);
    let stringOffset: number = 0;
    for (const [index, [nameId]] of names.entries()) {
        const record: number = 6 + 12 * index;
        const length: number = strings[index]?.length ?? 0;
        header.writeUInt16BE(3, record);
        header.writeUInt16BE(1, record + 2);
        header.writeUInt16BE(0x0409, record + 4);
        header.writeUInt16BE(nameId, record + 6);
        header.writeUInt16BE(length, record + 8);
        header.writeUInt16BE(stringOffset, record + 10);
        stringOffset += length;
    }
    return Buffer.concat([header, ...strings]);
}

// eslint-disable-next-line jsdoc/require-jsdoc
function postTable(): Buffer {
    const table: Buffer = Buffer.alloc(32);
    // version 3: no glyph names
    table.writeUInt32BE(0x0003_0000, 0);
    table.writeInt16BE(-100, 8);
    table.writeInt16BE(50, 10);
    return table;
}

/**
 * Puts the tables into one font file: the directory, then each table, four byte aligned.
 * @param tables - The tables, by tag.
 * @returns The file.
 */
function assemble(tables: Record<string, Buffer>): Buffer {
    const tags: string[] = Object.keys(tables).sort();
    const entrySelector: number = Math.floor(Math.log2(tags.length));
    const searchRange: number = 16 * 2 ** entrySelector;
    const directory: Buffer = Buffer.alloc(12 + 16 * tags.length);
    directory.writeUInt32BE(0x0001_0000, 0);
    directory.writeUInt16BE(tags.length, 4);
    directory.writeUInt16BE(searchRange, 6);
    directory.writeUInt16BE(entrySelector, 8);
    directory.writeUInt16BE(16 * tags.length - searchRange, 10);

    const bodies: Buffer[] = [];
    let offset: number = directory.length;
    for (const [index, tag] of tags.entries()) {
        const table: Buffer = tables[tag] ?? Buffer.alloc(0);
        const padded: Buffer = Buffer.concat([table, Buffer.alloc((4 - (table.length % 4)) % 4)]);
        const record: number = 12 + 16 * index;
        directory.write(tag.padEnd(4, ' '), record, 'latin1');
        directory.writeUInt32BE(checksumOf(padded), record + 4);
        directory.writeUInt32BE(offset, record + 8);
        directory.writeUInt32BE(table.length, record + 12);
        bodies.push(padded);
        offset += padded.length;
    }
    return Buffer.concat([directory, ...bodies]);
}

/**
 * The checksum of a table: the sum of its 32 bit words.
 * @param table - The table, padded to four bytes.
 * @returns The checksum.
 */
function checksumOf(table: Buffer): number {
    let sum: number = 0;
    for (let offset: number = 0; offset < table.length; offset += 4) {
        sum = (sum + table.readUInt32BE(offset)) >>> 0;
    }
    return sum;
}
