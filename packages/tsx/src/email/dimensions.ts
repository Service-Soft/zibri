/**
 * Parses a `NNNpx` (or bare number) length to its number, or 0 when it is not one.
 * @param length - The length string.
 * @returns The pixel count.
 */
export function pixels(length: string): number {
    return Number.parseFloat(length) || 0;
}

/**
 * Per-side padding overrides, each replacing that side of the shorthand when set. Mirrors MJML's
 * `padding-top`/`padding-right`/`padding-bottom`/`padding-left`.
 */
export type PaddingSides = {
    /**
     * Overrides the top padding.
     */
    top?: string,
    /**
     * Overrides the right padding.
     */
    right?: string,
    /**
     * Overrides the bottom padding.
     */
    bottom?: string,
    /**
     * Overrides the left padding.
     */
    left?: string
};

/**
 * Resolves a padding shorthand together with per-side overrides. When no side is overridden the
 * shorthand is returned unchanged (so defaults stay byte-for-byte what MJML emits); otherwise the
 * four sides are expanded with each override applied, as MJML does.
 * @param padding - The base padding shorthand, e.g. `10px 25px`.
 * @param sides - The per-side overrides.
 * @returns The resolved padding value.
 */
export function resolvePadding(padding: string, sides: PaddingSides): string {
    if (sides.top === undefined && sides.right === undefined && sides.bottom === undefined && sides.left === undefined) {
        return padding;
    }
    const parts: string[] = padding.trim().split(/\s+/);
    const top: string = parts[0] ?? '0';
    const right: string = parts[1] ?? top;
    const bottom: string = parts[2] ?? top;
    const left: string = parts[3] ?? right;
    return `${sides.top ?? top} ${sides.right ?? right} ${sides.bottom ?? bottom} ${sides.left ?? left}`;
}

/**
 * The combined left and right padding of a CSS padding shorthand, in pixels. Content components size
 * themselves to the container width minus this, the way MJML does.
 * @param padding - A padding shorthand, e.g. `10px 25px`.
 * @returns The horizontal padding in pixels.
 */
export function horizontalPadding(padding: string): number {
    const parts: number[] = padding.trim().split(/\s+/)
        .map(pixels);
    switch (parts.length) {
        case 1: {
            return parts[0] * 2;
        }
        case 4: {
            return parts[1] + parts[3];
        }
        default: {
            // Two values (`v h`) or three (`t h b`): the horizontal one is the second, applied twice.
            return parts[1] * 2;
        }
    }
}