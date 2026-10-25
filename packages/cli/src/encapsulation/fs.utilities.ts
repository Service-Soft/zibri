import { Dirent } from 'fs';
import { access, writeFile, mkdir, mkdtemp, readFile, readdir, rm, rename, cp } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, posix } from 'path';

import { getPath, Path } from '../utilities';

/**
 * Definition for a line in a file.
 * Contains its index, as well as its content.
 */
export type FileLine = {
    /**
     * The index of the line inside the file lines.
     */
    index: number,
    /**
     * The content of the line.
     */
    content: string
};

/**
 * Encapsulates functionality of the fs package.
 */
export abstract class FsUtilities {

    /**
     * Gets file lines between the provided indices.
     * @param lines - The string lines to build the FileLine[] from.
     * @param fromIndex - From which index to start.
     * @param untilIndex - Until which index to build.
     * @returns An array of FileLine.
     */
    static getFileLines(lines: string[], fromIndex: number, untilIndex: number): FileLine[] {
        const allLines: FileLine[] = [];
        for (let i: number = 0; i < lines.length; i++) {
            allLines.push({ content: lines[i], index: i });
        }
        return allLines.filter(l => l.index >= fromIndex && l.index <= untilIndex);
    }

    /**
     * Tries to find a line inside the provided lines which contains the given content.
     * You can optionally filter to only search in a specified line range.
     * @param linesOrPath - The lines or the path of the file to search in.
     * @param content - The content to search for.
     * @param fromIndex - At which line the search should start. Defaults to 0,.
     * @param untilIndex - At which line the search should end. Defaults to the end of the array.
     * @returns The found line.
     * @throws When no line could be found.
     */
    static async findLineWithContent(
        linesOrPath: Path | string[],
        content: string,
        fromIndex: number = 0,
        untilIndex?: number
    ): Promise<FileLine> {
        const lines: string[] = typeof linesOrPath === 'string' ? await this.readFileLines(linesOrPath) : linesOrPath;
        untilIndex = untilIndex ?? lines.length - 1;

        let line: FileLine = { index: fromIndex, content: lines[fromIndex] };
        while (!line.content.includes(content)) {
            const i: number = line.index + 1;
            if (i > untilIndex) {
                throw new Error(`Could not find line with content "${content}" in the lines ${fromIndex}-${untilIndex}`);
            }
            line = { index: i, content: lines[i] };
        }

        return line;
    }

    /**
     * Checks if a file at the given path exists.
     * @param path - The path to check.
     * @returns True when a file could be accessed and false otherwise.
     */
    static async exists(path: Path): Promise<boolean> {
        try {
            await access(path);
            return true;
        }
        catch {
            return false;
        }
    }

    /**
     * Renames "from" to "to".
     * @param from - The old path.
     * @param to - The new path.
     */
    static async rename(from: string, to: string): Promise<void> {
        await rename(from, to);
    }

    /**
     * Replace all instances of oldContent in the file at the given path with newContent.
     * @param path - The path of the file.
     * @param oldContent - The old content that should be replaced.
     * @param newContent - The new content that should replace the old one.
     * @param fromIndex - The starting line index (inclusive). Defaults to the start of the file.
     * @param untilIndex - The ending line index (inclusive). Defaults to the end of the file.
     */
    static async replaceAllInFile(
        path: Path,
        oldContent: string | RegExp,
        newContent: string,
        fromIndex?: number,
        untilIndex?: number
    ): Promise<void> {
        await this.replaceContentInFile(path, oldContent, newContent, true, fromIndex, untilIndex);
    }

    /**
     * Replace all instances of oldContent in the file at the given path with newContent.
     * @param path - The path of the file.
     * @param oldContent - The old content that should be replaced.
     * @param newContent - The new content that should replace the old one.
     * @param fromIndex - The starting line index (inclusive). Defaults to the start of the file.
     * @param untilIndex - The ending line index (inclusive). Defaults to the end of the file.
     */
    static async replaceInFile(
        path: Path,
        oldContent: string | RegExp,
        newContent: string,
        fromIndex?: number,
        untilIndex?: number
    ): Promise<void> {
        await this.replaceContentInFile(path, oldContent, newContent, false, fromIndex, untilIndex);
    }

    private static async replaceContentInFile(
        path: Path,
        oldContent: string | RegExp,
        newContent: string,
        all: boolean,
        fromIndex?: number,
        untilIndex?: number
    ): Promise<void> {
        let content: string = await this.readFile(path);
        const lines: string[] = content.split('\n');

        // Normalize indexes
        const start: number = fromIndex ?? 0;
        const end: number = untilIndex !== undefined ? untilIndex + 1 : lines.length;
        const beforeLines: string[] = lines.slice(0, start);
        const afterLines: string[] = lines.slice(end);

        const stringToModify: string = lines.slice(start, end).join('\n');
        const modifiedLines: string = stringToModify[all ? 'replaceAll' : 'replace'](oldContent, newContent);

        content = [...beforeLines, ...modifiedLines.split('\n'), ...afterLines].join('\n');
        await this.updateFile(path, content, 'replace');
    }

    /**
     * Creates a file at the given path.
     * @param path - The path of the new file to create.
     * @param data - The data to write into the file. Can be a raw data string or an array of lines, which are joined by \n.
     * @param recursive - Whether or not to recursively create the file.
     * @param log - Whether or not the success of the creation should be logged to the console.
     */
    static async createFile(path: Path, data: string | string[], recursive: boolean = true, log: boolean = true): Promise<void> {
        if (await this.exists(path)) {
            throw new Error(`File at ${path} already exists. Did you mean to call "updateFile"?`);
        }
        data = this.normalizeData(data);
        const parentDir: Path = dirname(path) as Path;
        if (recursive && !await this.exists(parentDir)) {
            await this.mkdir(parentDir, true, false);
        }
        await writeFile(path, data);
        if (log) {
            // eslint-disable-next-line no-console
            console.log('created', path);
        }
    }

    private static normalizeData(data: string | string[]): string {
        if (Array.isArray(data)) {
            data = data.join('\n');
        }
        data = data.replaceAll('\t', '    ');
        return data.endsWith('\n') ? data.slice(0, -1) : data;
    }

    /**
     * Updates the file at the given path with the given data.
     * Can either replace, prepend or append.
     * @param path - The path of the new file to create.
     * @param data - The data to write into the file. Can be a raw data string or an array of lines, which are joined by \n.
     * @param action - Whether the data should replace the current content or be pre-/appended.
     * @param log - Whether or not the success of the update should be logged to the console.
     */
    static async updateFile(
        path: Path,
        data: string | string[],
        action: 'replace' | 'prepend' | 'append',
        log: boolean = true
    ): Promise<void> {
        if (!await this.exists(path)) {
            throw new Error(`File at ${path} does not exist. Did you mean to call "createFile"?`);
        }

        data = this.normalizeData(data);
        switch (action) {
            case 'replace': {
                await writeFile(path, data);
                break;
            }
            case 'append': {
                let currentContent: string[] = await this.readFileLines(path);
                currentContent = currentContent[0].length ? [...currentContent, data] : [data];
                await writeFile(path, this.normalizeData(currentContent));
                break;
            }
            case 'prepend': {
                let currentContent: string[] = await this.readFileLines(path);
                currentContent = currentContent[0].length ? [data, ...currentContent] : [data];
                await writeFile(path, this.normalizeData(currentContent));
                break;
            }
        }
        if (log) {
            // eslint-disable-next-line no-console
            console.log('updated', path);
        }
    }

    /**
     * Reads the file content at the given path.
     * Expects utf-8.
     * @param path - The path of the file to read.
     * @returns The content as a single string.
     */
    static async readFile(path: Path): Promise<string> {
        return readFile(path, { encoding: 'utf8' });
    }

    /**
     * Reads the file content at the given path, byte for byte.
     * @param path - The path of the file to read.
     * @returns The content.
     */
    static async readFileBuffer(path: Path): Promise<Buffer> {
        return readFile(path);
    }

    /**
     * Writes the given content to the file at the given path, byte for byte, replacing whatever it held.
     * Creates the folders above it when they are missing.
     * @param path - The path of the file to write.
     * @param content - What the file holds afterwards.
     */
    static async writeFileBuffer(path: Path, content: Buffer): Promise<void> {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
    }

    /**
     * Creates an empty directory of its own in the system's temporary folder.
     * @param prefix - What its name starts with.
     * @returns Its path.
     */
    static async mkdtemp(prefix: string): Promise<Path> {
        return getPath(await mkdtemp(join(tmpdir(), prefix)));
    }

    /**
     * Finds every file below a directory.
     * @param path - The directory to search.
     * @param exclude - Paths relative to it that are skipped, with everything below them.
     * @returns The paths of the files, relative to it and separated by "/" on every platform.
     */
    static async findFiles(path: Path, exclude: string[] = []): Promise<string[]> {
        const files: string[] = [];
        const visit: (relativeDir: string) => Promise<void> = async relativeDir => {
            for (const entry of await this.readdir(getPath(path, relativeDir))) {
                const relativePath: string = relativeDir === '' ? entry.name : posix.join(relativeDir, entry.name);
                if (exclude.includes(relativePath)) {
                    continue;
                }
                if (entry.isDirectory()) {
                    await visit(relativePath);
                    continue;
                }
                files.push(relativePath);
            }
        };
        await visit('');
        return files;
    }

    /**
     * Same as readFile, but returns the content as an array of lines instead.
     * @param path - The path of the file to read the lines from.
     * @returns The content as an array of line strings.
     */
    static async readFileLines(path: Path): Promise<string[]> {
        const content: string = await this.readFile(path);
        return content.split('\n');
    }

    /**
     * Removes either a file or directory.
     * @param path - The path to remove.
     * @param recursive - Whether or not subdirectories should be deleted as well. Defaults to true.
     */
    static async rm(path: Path, recursive: boolean = true): Promise<void> {
        if (!await this.exists(path)) {
            return;
        }
        await rm(path, { recursive: recursive, force: true });
    }

    /**
     * Creates a directory at the given path.
     * @param path - The path of the directory to create.
     * @param recursive - Whether or not missing directories in the path should be created as well.
     * @param log - Whether or not the success of the creation should be logged to the console.
     */
    static async mkdir(path: Path, recursive: boolean = true, log: boolean = true): Promise<void> {
        await mkdir(path, { recursive: recursive });
        if (log) {
            // eslint-disable-next-line no-console
            console.log('created', path);
        }
    }

    /**
     * Gets the root level subdirectories and files of the directory at the provided path.
     * @param path - The path of the directory to get the contents of.
     * @returns An array of the directory contents.
     */
    static async readdir(path: Path): Promise<Dirent[]> {
        return readdir(path, { withFileTypes: true });
    }

    /**
     * Moves the contents of the given source inside the given destination.
     * Overrides any contents that might already exist inside the destination.
     * @param sourcePath - The source folder to move the content of.
     * @param destinationPath - The destination folder where the content should be moved inside.
     * @param isIncluded - Whether a file is copied, by the path it is copied to. Every file by default.
     */
    static async copyDirectoryContent(
        sourcePath: Path,
        destinationPath: Path,
        isIncluded: (destination: Path) => boolean = () => true
    ): Promise<void> {
        const entries: Dirent[] = await this.readdir(sourcePath);
        await Promise.all(entries.map(e => this.copyEntry(e, destinationPath, isIncluded)));
    }

    private static async copyEntry(
        entry: Dirent,
        destination: string,
        isIncluded: (destination: Path) => boolean
    ): Promise<void> {
        const source: Path = getPath(entry.parentPath, entry.name);
        const destName: string = entry.name.split('.tpl')[0];
        const dest: Path = getPath(destination, destName);

        if (entry.isDirectory()) {
            const children: Dirent[] = await this.readdir(source);
            await Promise.all(children.map(child => this.copyEntry(child, dest, isIncluded)));
            return;
        }
        if (!isIncluded(dest)) {
            return;
        }
        // the folder is created for the files copied into it, so a folder none of them is copied to is never created
        await mkdir(dirname(dest), { recursive: true });
        // It's a file — copy it with the (possibly renamed) destination
        // eslint-disable-next-line angular/no-experimental
        await cp(source, dest, { errorOnExist: true });
    }
}