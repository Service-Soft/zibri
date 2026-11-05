/**
 * A 0-based offset range into the original source text.
 */
export type SourceSpan = {
    /**
     * Inclusive start offset (0-based) into the source.
     */
    start: number,
    /**
     * Exclusive end offset into the source.
     */
    end: number
};

/**
 * Severity of a {@link Diagnostic}.
 */
export enum DiagnosticSeverity {
    ERROR = 'error',
    WARNING = 'warning'
}

/**
 * A located compiler message (dialect violation, parse error, etc.).
 */
export type Diagnostic = {
    /**
     * Stable machine-readable code, e.g. 'ZTSX001'.
     */
    code: string,
    /**
     * Human-readable, actionable message.
     */
    message: string,
    /**
     * The severity of the diagnostic.
     */
    severity: DiagnosticSeverity,
    /**
     * The source span the diagnostic points at.
     */
    span: SourceSpan
};

/**
 * Human-readable 1-based line/column derived from an offset.
 */
export type LineColumn = {
    /**
     * 1-based line number.
     */
    line: number,
    /**
     * 1-based column number.
     */
    column: number
};

/**
 * Resolves a 0-based source offset to a 1-based line/column, for error reporting.
 * @param source - The full source text.
 * @param offset - The 0-based offset into the source.
 * @returns The 1-based line and column.
 */
export function offsetToLineColumn(source: string, offset: number): LineColumn {
    const clamped: number = Math.max(0, Math.min(offset, source.length));
    let line: number = 1;
    let lineStart: number = 0;
    for (let i: number = 0; i < clamped; i++) {
        if (source[i] === '\n') {
            line++;
            lineStart = i + 1;
        }
    }
    return { line, column: clamped - lineStart + 1 };
}

/**
 * Formats the diagnostics of a template that failed to compile into one readable error.
 * @param diagnostics - The diagnostics to format.
 * @param source - The source they refer to.
 * @param file - The file path, for context.
 * @returns The error to report.
 */
export function resolveCompileError(diagnostics: Diagnostic[], source: string, file: string): Error {
    const lines: string[] = diagnostics.map(diagnostic => {
        const { line, column } = offsetToLineColumn(source, diagnostic.span.start);
        return `${file}:${line}:${column} ${diagnostic.code} ${diagnostic.message}`;
    });
    return new Error(`zibri-tsx failed to compile:\n${lines.join('\n')}`);
}