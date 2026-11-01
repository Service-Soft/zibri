import type { Column, Content, ContentText, DynamicContent, OrderedListElement, Style, StyleDictionary, StyleReference, Table, TableCell, TDocumentDefinitions, UnorderedListElement } from 'pdfmake/interfaces';

/**
 * An element of a document, as opposed to a text or a list of them.
 */
type PdfElement = Exclude<Content, string | number | Content[]>;

/**
 * Whether a table cell is the empty one a row or column span covers.
 * @param cell - The cell.
 * @returns True for an empty cell.
 */
function isSpannedCell(cell: TableCell): cell is Record<PropertyKey, never> {
    return typeof cell === 'object' && !Array.isArray(cell) && Object.keys(cell).length === 0;
}

/**
 * What a font says about the characters it can draw.
 */
export type PdfGlyphCoverage = {
    /**
     * Whether the font has a glyph for the character.
     */
    hasGlyphForCodePoint: (codePoint: number) => boolean
};

/**
 * The fonts a document is set in, and which of them stand in for a character a text's own font lacks.
 */
export type PdfFontFallbackContext = {
    /**
     * What each registered family can draw, by its name. A family not in here is taken to draw everything.
     */
    coverage: ReadonlyMap<string, PdfGlyphCoverage>,
    /**
     * The families tried, in order, for a character the text's own font lacks.
     */
    fallbacks: string[],
    /**
     * The styles of the document, which may name a font.
     */
    styles: StyleDictionary | undefined
};

/**
 * The font of a document whose definition names none.
 */
const DEFAULT_FONT: string = 'Roboto';

/**
 * Matches the characters that belong to whichever run they are in, so that the spaces of a name set
 * in a fallback font do not cut it into pieces.
 */
const RUN_NEUTRAL: RegExp = /\s/u;

/**
 * Sets each character of a document in the first font that can draw it.
 *
 * A pdf draws a text in one font, and a character that font lacks comes out blank. Every text is
 * therefore split into runs, each set in its own font: the text's own where it has the glyph, and
 * otherwise the first fallback that does. The text's own font is the one pdfmake would use, named by
 * the element, its style or the element around it.
 */
export abstract class PdfFontFallbackUtilities {

    /**
     * Applies the fallbacks to a document.
     * @param definition - The document.
     * @param context - The fonts, and which of them stand in.
     * @returns The document with every text a font lacks characters of split into runs. The same
     * definition when no text needs it.
     */
    static apply<T extends TDocumentDefinitions>(definition: T, context: PdfFontFallbackContext): T {
        const font: string = definition.defaultStyle?.font ?? DEFAULT_FONT;
        const withStyles: PdfFontFallbackContext = { ...context, styles: definition.styles };
        return {
            ...definition,
            content: this.applyToContent(definition.content, font, withStyles),
            header: this.applyToHeaderOrFooter(definition.header, font, withStyles),
            footer: this.applyToHeaderOrFooter(definition.footer, font, withStyles)
        };
    }

    private static applyToHeaderOrFooter(
        content: DynamicContent | Content | undefined,
        font: string,
        context: PdfFontFallbackContext
    ): DynamicContent | Content | undefined {
        if (content == undefined) {
            return content;
        }
        if (typeof content !== 'function') {
            return this.applyToContent(content, font, context);
        }
        return (currentPage, pageCount, pageSize) => {
            const resolved: Content | null | undefined = content(currentPage, pageCount, pageSize);
            return resolved == undefined ? resolved : this.applyToContent(resolved, font, context);
        };
    }

    private static applyToContent(content: Content, font: string, context: PdfFontFallbackContext): Content {
        if (typeof content === 'string') {
            return this.applyToText(content, font, context);
        }
        if (typeof content === 'number') {
            return content;
        }
        if (Array.isArray(content)) {
            return content.map(item => this.applyToContent(item, font, context));
        }
        return this.applyToElement(content, font, context);
    }

    /**
     * Applies the fallbacks to the texts inside an element, keeping everything else it holds, such as
     * the width of a column or the span of a table cell.
     * @param element - The element.
     * @param font - The font around it.
     * @param context - The fonts.
     * @returns The element with its texts split.
     */
    private static applyToElement<E extends PdfElement>(element: E, font: string, context: PdfFontFallbackContext): E {
        const own: string = this.resolveFont(element.font, element.style, font, context);
        const text: Content | undefined = element.text;
        if (text !== undefined) {
            return { ...element, text: this.applyToContent(text, own, context) };
        }
        const stack: Content[] | undefined = element.stack;
        if (stack !== undefined) {
            return { ...element, stack: stack.map(item => this.applyToContent(item, own, context)) };
        }
        const columns: Column[] | undefined = element.columns;
        if (columns !== undefined) {
            return { ...element, columns: columns.map(column => this.applyToNested(column, own, context)) };
        }
        const ul: UnorderedListElement[] | undefined = element.ul;
        if (ul !== undefined) {
            return { ...element, ul: ul.map(item => this.applyToNested(item, own, context)) };
        }
        const ol: OrderedListElement[] | undefined = element.ol;
        if (ol !== undefined) {
            return { ...element, ol: ol.map(item => this.applyToNested(item, own, context)) };
        }
        const table: Table | undefined = element.table;
        if (table !== undefined) {
            const body: TableCell[][] = table.body.map(row => row.map(cell => isSpannedCell(cell) ? cell : this.applyToNested(cell, own, context)));
            return { ...element, table: { ...table, body } };
        }
        return element;
    }

    /**
     * Applies the fallbacks to content that carries properties of the element around it, such as a
     * column or a list item.
     * @param content - The content.
     * @param font - The font around it.
     * @param context - The fonts.
     * @returns The content with its texts split, and its properties kept.
     */
    private static applyToNested<C extends Content>(content: C, font: string, context: PdfFontFallbackContext): C | Content {
        if (typeof content !== 'object' || Array.isArray(content)) {
            return this.applyToContent(content, font, context);
        }
        return this.applyToElement(content, font, context);
    }

    /**
     * Splits a text into runs by the font that can draw each character.
     * @param text - The text.
     * @param font - Its own font.
     * @param context - The fonts.
     * @returns The text as it is when its own font draws all of it, and otherwise its runs.
     */
    private static applyToText(text: string, font: string, context: PdfFontFallbackContext): Content {
        const runs: { text: string, font: string }[] = [];
        for (const char of text) {
            const previous: { text: string, font: string } | undefined = runs.at(-1);
            const chosen: string = previous != undefined && RUN_NEUTRAL.test(char)
                ? previous.font
                : this.resolveFontFor(char.codePointAt(0) ?? 0, font, context);
            if (previous?.font === chosen) {
                previous.text += char;
            }
            else {
                runs.push({ text: char, font: chosen });
            }
        }
        if (runs.length <= 1 && (runs[0]?.font ?? font) === font) {
            return text;
        }
        const inline: (string | ContentText)[] = runs.map(run => run.font === font ? run.text : { text: run.text, font: run.font });
        return { text: inline };
    }

    /**
     * The font a character is set in.
     * @param codePoint - The character.
     * @param font - The text's own font.
     * @param context - The fonts.
     * @returns The text's own font when it can draw the character, the first fallback that can
     * otherwise, and the text's own when none can.
     */
    private static resolveFontFor(codePoint: number, font: string, context: PdfFontFallbackContext): string {
        if (this.draws(font, codePoint, context)) {
            return font;
        }
        return context.fallbacks.find(fallback => fallback !== font && this.draws(fallback, codePoint, context)) ?? font;
    }

    private static draws(font: string, codePoint: number, context: PdfFontFallbackContext): boolean {
        return context.coverage.get(font)?.hasGlyphForCodePoint(codePoint) ?? true;
    }

    /**
     * The font an element is set in, as pdfmake picks it: its own, then the last of its styles that
     * names one, then the one around it.
     * @param own - The font the element names.
     * @param style - The styles it names.
     * @param inherited - The font around it.
     * @param context - The fonts, and the styles of the document.
     * @returns The font.
     */
    private static resolveFont(
        own: string | undefined,
        style: StyleReference | undefined,
        inherited: string,
        context: PdfFontFallbackContext
    ): string {
        if (own != undefined) {
            return own;
        }
        const references: (string | Style)[] = style == undefined ? [] : Array.isArray(style) ? style : [style];
        for (const reference of [...references].reverse()) {
            const named: string | undefined = typeof reference === 'string' ? context.styles?.[reference]?.font : reference.font;
            if (named != undefined) {
                return named;
            }
        }
        return inherited;
    }
}
