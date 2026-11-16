import { findSourceMap, SourceMap, SourceOrigin } from 'node:module';

// per file and per position, because a log call asks on every call and both answers never change. The
// positions are the ones code logs from, so they are as many as the application has log calls
const sourceMaps: Map<string, SourceMap | undefined> = new Map();
const originalFiles: Map<string, string> = new Map();

/**
 * Resolves the file a frame of a stack trace was written in.
 * @param callSite - The frame.
 * @returns The file the source map of the frame's file names for it. Without a map, which is what a
 * process started without `--enable-source-maps` has for every file, the frame's file itself.
 */
export function resolveOriginalFile(callSite: NodeJS.CallSite): string | undefined {
    const fileName: string | undefined = callSite.getFileName() ?? undefined;
    if (fileName == undefined) {
        return undefined;
    }
    if (!sourceMaps.has(fileName)) {
        sourceMaps.set(fileName, findSourceMap(fileName));
    }
    const sourceMap: SourceMap | undefined = sourceMaps.get(fileName);
    if (sourceMap == undefined) {
        return fileName;
    }

    const line: number = callSite.getLineNumber() ?? 0;
    const column: number = callSite.getColumnNumber() ?? 0;
    const position: string = `${fileName}:${line}:${column}`;
    const known: string | undefined = originalFiles.get(position);
    if (known != undefined) {
        return known;
    }
    const origin: SourceOrigin | object = sourceMap.findOrigin(line, column);
    // a replace and not `fileURLToPath`, which throws on what a map may hold, and this runs inside a log call
    const originalFile: string = 'fileName' in origin ? origin.fileName.replace(/^file:\/\//, '') : fileName;
    originalFiles.set(position, originalFile);
    return originalFile;
}