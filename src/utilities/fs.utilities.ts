import { createReadStream, createWriteStream, Dirent, ReadStream, Stats, WriteStream } from 'node:fs';
import { access, writeFile, mkdir, readFile, readdir, rm, rename, stat } from 'node:fs/promises';
import path from 'node:path';

import { glob } from 'glob';

/**
 * The type for a file path.
 */
export type Path = string & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    __brand: 'Path'
};

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
     * The file system separator.
     */
    static readonly separator: '\\' | '/' = path.sep;

    /**
     * Creates a new read stream on the file at the given path.
     * @param path - The path to read from.
     * @param options - Additional streaming options.
     * @returns The newly created read stream.
     */
    static createReadStream(path: Path, options?: Exclude<Parameters<typeof createReadStream>[1], BufferEncoding>): ReadStream {
        return createReadStream(path, { encoding: 'utf8', ...options });
    }

    /**
     * Creates a new write stream on the file at the given path.
     * @param path - The path to write to.
     * @param options - Additional streaming options.
     * @returns The newly created write stream.
     */
    static createWriteStream(path: Path, options?: Exclude<Parameters<typeof createWriteStream>[1], BufferEncoding>): WriteStream {
        return createWriteStream(path, { encoding: 'utf8', ...options });
    }

    /**
     * Return the extension of the path, from the last '.' to end of string in the last portion of the path. If there is no '.' in the last portion of the path or the first character of it is '.', then it returns an empty string.
     * @param p - The path to evaluate.
     * @returns The file extension.
     */
    static extensionName(p: Path): string {
        return path.extname(p);
    }

    /**
     * Return the last portion of a path. Similar to the Unix basename command. Often used to extract the file name from a fully qualified path.
     * @param p - The path to evaluate.
     * @returns The last portion of the given path.
     */
    static baseName(p: Path): string {
        return path.basename(p);
    }

    /**
     * Return the directory name of a path. Similar to the Unix dirname command.
     * @param p - The path to evaluate.
     * @returns The name of the directory as a string.
     */
    static dirName(p: Path): string {
        return path.dirname(p);
    }

    /**
     * Solve the relative path from {from} to {to} based on the current working directory.
     * At times we have two absolute paths, and we need to derive the relative path from one to the other.
     * This is actually the reverse transform of path.resolve.
     * @param from - Where the relative path should start.
     * @param to - Where the relative path should end/point to.
     * @returns The fully resolved relative path.
     */
    static relative(from: Path, to: Path): Path {
        return path.relative(from, to) as Path;
    }

    /**
     * The right-most parameter is considered {to}. Other parameters are considered an array of {from}.
     * Starting from leftmost {from} parameter, resolves {to} to an absolute path.
     * If {to} isn't already absolute, {from} arguments are prepended in right to left order, until an absolute path is found.
     * If after using all {from} paths still no absolute path is found, the current working directory is used as well.
     * The resulting path is normalized, and trailing slashes are removed unless the path gets resolved to the root directory.
     * @param paths - The paths that should be resolved.
     * @returns The resolved path.
     */
    static resolve(...paths: string[]): Path {
        return path.resolve(...paths) as Path;
    }

    /**
     * Perform an asynchronous glob search for the pattern(s) specified.
     * @param pattern - The pattern to search for.
     * @returns The matching paths.
     */
    static async glob(pattern: string | string[]): Promise<Path[]> {
        return await glob(pattern) as Path[];
    }

    /**
     * Gets a path from the provided segments.
     * @param paths - The segments to get the path from.
     * @returns The cleaned up path.
     * @throws When the path could not be built from the provided segments.
     */
    static getPath(...paths: string[]): Path {
        try {
            const basePath: string = path.join(...paths);
            if (path.isAbsolute(basePath)) {
                return basePath as Path;
            }
            return path.join('', basePath) as Path;
        }
        catch (error) {
            throw new Error(`Error trying to get the path ${paths.join()}`, { cause: error });
        }
    }

    /**
     * Gives information about the file or directory at the provided path.
     * @param path - The path to get info on.
     * @returns Information like file size etc.
     */
    static async stat(path: Path): Promise<Stats> {
        return await stat(path);
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
     * Creates a file at the given path.
     * @param p - The path of the new file to create.
     * @param data - The data to write into the file. Can be a raw data string or an array of lines, which are joined by \n.
     * @param recursive - Whether or not to recursively create the file.
     */
    static async createFile(p: Path, data: string | string[], recursive: boolean = true): Promise<void> {
        if (await this.exists(p)) {
            throw new Error(`File at ${p} already exists. Did you mean to call "updateFile"?`);
        }
        data = this.normalizeData(data);
        const parentDir: Path = path.dirname(p) as Path;
        if (recursive && !await this.exists(parentDir)) {
            await this.mkdir(parentDir, true);
        }
        await writeFile(p, data);
    }

    private static normalizeData(data: string | string[]): string {
        if (Array.isArray(data)) {
            data = data.join('\n');
        }
        return data;
    }

    /**
     * Updates the file at the given path with the given data.
     * Can either replace, prepend or append.
     * @param path - The path of the new file to create.
     * @param data - The data to write into the file. Can be a raw data string or an array of lines, which are joined by \n.
     * @param action - Whether the data should replace the current content or be pre-/appended.
     */
    static async updateFile(
        path: Path,
        data: string | string[],
        action: 'replace' | 'prepend' | 'append'
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
    }

    /**
     * Either creates or overrides the file at the given path with the given data.
     * @param path - The path of the file to create/override.
     * @param data - The data to write into the file. Can be a raw data string or an array of lines, which are joined by \n.
     */
    static async upsertFile(path: Path, data: string | string[]): Promise<void> {
        if (!await this.exists(path)) {
            await this.createFile(path, data);
            return;
        }

        await this.updateFile(path, data, 'replace');
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
        await rm(path, { recursive, force: true });
    }

    /**
     * Creates a directory at the given path.
     * @param path - The path of the directory to create.
     * @param recursive - Whether or not missing directories in the path should be created as well. Defaults to true.
     */
    static async mkdir(path: Path, recursive: boolean = true): Promise<void> {
        await mkdir(path, { recursive });
    }

    /**
     * Gets the root level subdirectories and files of the directory at the provided path.
     * @param path - The path of the directory to get the contents of.
     * @returns An array of the directory contents.
     */
    static async readdir(path: Path): Promise<Dirent[]> {
        return readdir(path, { withFileTypes: true });
    }
}