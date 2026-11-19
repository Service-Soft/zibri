import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, Dirent, existsSync, readFileSync, ReadStream, Stats, StatsFs, WriteStream } from 'node:fs';
import { access, writeFile, mkdir, readFile, readdir, rm, rmdir, rename, stat, statfs, glob, link, open, FileHandle } from 'node:fs/promises';
import path from 'node:path';

import { InternalError } from '../error-handling/internal-error.model';

/**
 * The type for a file path.
 */
export type FsPath = string & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    __brand: 'Path'
};

/**
 * Definition of a glob pattern. Can either be a string/string array or an object that also defines "excludes".
 */
export type GlobPattern = string | string[] | {
    /**
     * The patterns to search for.
     */
    include: string | string [],
    /**
     * The patterns to exclude.
     */
    exclude?: string | string[]
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
     * @param filePath - The path to read from.
     * @param options - Additional streaming options.
     * @returns The newly created read stream, handing out the file's bytes unless the options name an
     * encoding.
     */
    static createReadStream(filePath: FsPath, options?: Exclude<Parameters<typeof createReadStream>[1], BufferEncoding>): ReadStream {
        // no encoding by default: this used to decode as utf8, which changes any file that is not
        // text - a served image, an encrypted backup - and a text file too wherever a character
        // spans the end of one ranged read and the start of the next
        return createReadStream(filePath, options);
    }

    /**
     * Creates a new write stream on the file at the given path.
     * @param filePath - The path to write to.
     * @param options - Additional streaming options.
     * @returns The newly created write stream.
     */
    static createWriteStream(filePath: FsPath, options?: Exclude<Parameters<typeof createWriteStream>[1], BufferEncoding>): WriteStream {
        return createWriteStream(filePath, { encoding: 'utf8', ...options });
    }

    /**
     * Return the extension of the path, from the last '.' to end of string in the last portion of the path. If there is no '.' in the last portion of the path or the first character of it is '.', then it returns an empty string.
     * @param p - The path to evaluate.
     * @returns The file extension.
     */
    static extensionName(p: FsPath): string {
        return path.extname(p);
    }

    /**
     * Return the last portion of a path. Similar to the Unix basename command. Often used to extract the file name from a fully qualified path.
     * @param p - The path to evaluate.
     * @returns The last portion of the given path.
     */
    static baseName(p: FsPath): string {
        return path.basename(p);
    }

    /**
     * Return the directory name of a path. Similar to the Unix dirname command.
     * @param p - The path to evaluate.
     * @returns The name of the directory as a string.
     */
    static dirName(p: FsPath): FsPath {
        return path.dirname(p) as FsPath;
    }

    /**
     * Solve the relative path from {from} to {to} based on the current working directory.
     * At times we have two absolute paths, and we need to derive the relative path from one to the other.
     * This is actually the reverse transform of path.resolve.
     * @param from - Where the relative path should start.
     * @param to - Where the relative path should end/point to.
     * @returns The fully resolved relative path.
     */
    static relative(from: FsPath, to: FsPath): FsPath {
        return path.relative(from, to) as FsPath;
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
    static resolve(...paths: string[]): FsPath {
        return path.resolve(...paths) as FsPath;
    }

    /**
     * Perform an asynchronous glob search for the pattern(s) specified.
     * @param pattern - The pattern to search for.
     * @returns The matching paths.
     */
    static async glob(pattern: GlobPattern): Promise<FsPath[]> {
        const res: FsPath[] = [];
        const include: string | string[] = typeof pattern === 'string' || Array.isArray(pattern)
            ? pattern
            : pattern.include;
        const exclude: string | string[] = typeof pattern === 'string' || Array.isArray(pattern)
            ? []
            : pattern.exclude ?? [];

        for await (const matchedPath of glob(include, { exclude: Array.isArray(exclude) ? exclude : [exclude] })) {
            res.push(matchedPath as FsPath);
        }
        return res;
    }

    /**
     * Gets a path from the provided segments.
     * @param paths - The segments to get the path from.
     * @returns The cleaned up path.
     * @throws When the path could not be built from the provided segments.
     */
    static getPath(...paths: string[]): FsPath {
        try {
            const basePath: string = path.join(...paths);
            return path.isAbsolute(basePath) ? (basePath as FsPath) : (path.join('', basePath) as FsPath);
        }
        catch (error) {
            throw new InternalError(`Error trying to get the path ${paths.join()}`, { cause: error });
        }
    }

    /**
     * Gives information about the file or directory at the provided path.
     * @param entryPath - The path to get info on.
     * @returns Information like file size etc.
     */
    static async stat(entryPath: FsPath): Promise<Stats> {
        return await stat(entryPath);
    }

    /**
     * Resolves how many bytes the disk holding a path has free for this process.
     * @param p - The path, which need not exist yet: the disk of the nearest folder above it that does.
     * @returns The bytes free.
     */
    static async resolveFreeBytes(p: FsPath): Promise<number> {
        let current: FsPath = p;
        // a folder that is only created once something is staged in it is on the disk of the folder above it
        while (!await this.exists(current) && path.dirname(current) !== current) {
            current = path.dirname(current) as FsPath;
        }
        const stats: StatsFs = await statfs(current);
        // what an unprivileged process may take, without the blocks the file system keeps for root
        return stats.bavail * stats.bsize;
    }

    /**
     * Checks if a file at the given path exists.
     * @param filePath - The path to check.
     * @returns True when a file could be accessed and false otherwise.
     */
    static async exists(filePath: FsPath): Promise<boolean> {
        try {
            await access(filePath);
            return true;
        }
        catch {
            return false;
        }
    }

    /**
     * Checks if a file at the given path exists.
     *
     * PLEASE ALWAYS PREFER {@link FsUtilities.exists} DUE TO PERFORMANCE REASONS.
     * @param filePath - The path to check.
     * @returns True if the path exists, false otherwise.
     */
    static existsSync(filePath: FsPath): boolean {
        return existsSync(filePath);
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
     * Opens a file to be read.
     * @param p - The file.
     * @returns Its handle, which the caller closes, or hands to a stream that closes it.
     */
    static async openForReading(p: FsPath): Promise<FileHandle> {
        return await open(p, 'r');
    }

    /**
     * Writes what the system still holds of a file to the disk, so that it outlasts the machine going down.
     * @param p - The file.
     */
    static async sync(p: FsPath): Promise<void> {
        const handle: FileHandle = await open(p, 'r+');
        try {
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }

    /**
     * Writes what the system still holds of the entries of a directory to the disk, such as a file renamed
     * into it or a directory created in it, so that they outlast the machine going down. Nothing on
     * Windows, which cannot open a directory to do so.
     * @param p - The directory.
     */
    static async syncDirectory(p: FsPath): Promise<void> {
        if (process.platform === 'win32') {
            return;
        }
        const handle: FileHandle = await open(p, 'r');
        try {
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }

    /**
     * Creates a file at the given path.
     * @param p - The path of the new file to create.
     * @param data - The data to write into the file. Can be a raw data string or an array of lines, which are joined by \n.
     * @param recursive - Whether or not to recursively create the file. Defaults to true.
     */
    static async createFile(p: FsPath, data: string | string[], recursive: boolean = true): Promise<void> {
        if (!await this.createFileIfAbsent(p, data, recursive)) {
            throw new InternalError(`File at ${p} already exists. Did you mean to call "updateFile"?`);
        }
    }

    /**
     * Creates a file at the given path, unless there is one already.
     *
     * Whole or not at all: when several processes create the same file at once, exactly one of them does,
     * and nothing reads the file before all of its data is in it.
     * @param p - The path of the new file to create.
     * @param data - The data to write into the file. Can be a raw data string or an array of lines, which are joined by \n.
     * @param recursive - Whether or not to recursively create the file. Defaults to true.
     * @returns Whether the file was created, false when it existed.
     */
    static async createFileIfAbsent(p: FsPath, data: string | string[], recursive: boolean = true): Promise<boolean> {
        const parentDir: FsPath = path.dirname(p) as FsPath;
        if (recursive && !await this.exists(parentDir)) {
            await this.mkdir(parentDir, true);
        }
        // written beside it and linked into place: a link fails when the name is taken, and the name
        // appears with the whole file behind it. Checking first and writing after let two processes
        // both see no file, and let a third read one that was half written
        const temporary: string = `${p}.${randomBytes(6).toString('hex')}.tmp`;
        await writeFile(temporary, this.normalizeData(data));
        try {
            await link(temporary, p);
            return true;
        }
        catch (error) {
            if (this.hasErrorCode(error, 'EEXIST')) {
                return false;
            }
            if (!this.hasErrorCode(error, 'EPERM', 'ENOTSUP', 'EOPNOTSUPP')) {
                throw error;
            }
            // a file system without links, eg. FAT or some network mounts: still exclusive, though a
            // reader can see the file before it is complete
            return await this.writeExclusively(p, data);
        }
        finally {
            await rm(temporary, { force: true });
        }
    }

    private static async writeExclusively(p: FsPath, data: string | string[]): Promise<boolean> {
        try {
            await writeFile(p, this.normalizeData(data), { flag: 'wx' });
            return true;
        }
        catch (error) {
            if (this.hasErrorCode(error, 'EEXIST')) {
                return false;
            }
            throw error;
        }
    }

    /**
     * Whether an error node raised carries one of the given codes.
     * @param error - The error.
     * @param codes - The codes.
     * @returns True when it carries one of them.
     */
    private static hasErrorCode(error: unknown, ...codes: string[]): boolean {
        // by shape rather than with instanceof: an error node itself raises can come from another realm
        return typeof error === 'object'
            && error != undefined
            && 'code' in error
            && typeof error.code === 'string'
            && codes.includes(error.code);
    }

    /**
     * Whether the lines of a file are those of an empty file.
     * @param lines - The lines.
     * @returns True for one line holding nothing. A file whose first line is empty can hold more.
     */
    private static isEmpty(lines: string[]): boolean {
        return lines.length <= 1 && !lines[0]?.length;
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
     * @param filePath - The path of the new file to create.
     * @param data - The data to write into the file. Can be a raw data string or an array of lines, which are joined by \n.
     * @param action - Whether the data should replace the current content or be pre-/appended.
     */
    static async updateFile(
        filePath: FsPath,
        data: string | string[],
        action: 'replace' | 'prepend' | 'append'
    ): Promise<void> {
        if (!await this.exists(filePath)) {
            throw new InternalError(`File at ${filePath} does not exist. Did you mean to call "createFile"?`);
        }

        data = this.normalizeData(data);
        switch (action) {
            case 'replace': {
                await writeFile(filePath, data);
                break;
            }
            case 'append': {
                const currentContent: string[] = await this.readFileLines(filePath);
                await writeFile(filePath, this.normalizeData(this.isEmpty(currentContent) ? [data] : [...currentContent, data]));
                break;
            }
            case 'prepend': {
                const currentContent: string[] = await this.readFileLines(filePath);
                await writeFile(filePath, this.normalizeData(this.isEmpty(currentContent) ? [data] : [data, ...currentContent]));
                break;
            }
        }
    }

    /**
     * Either creates or overrides the file at the given path with the given data.
     * @param filePath - The path of the file to create/override.
     * @param data - The data to write into the file. Can be a raw data string or an array of lines, which are joined by \n.
     */
    static async upsertFile(filePath: FsPath, data: string | string[]): Promise<void> {
        if (!await this.exists(filePath)) {
            await this.createFile(filePath, data);
            return;
        }

        await this.updateFile(filePath, data, 'replace');
    }

    /**
     * Reads the file content at the given path.
     * Expects utf-8.
     * @param filePath - The path of the file to read.
     * @returns The content as a single string.
     */
    static async readFile(filePath: FsPath): Promise<string> {
        return readFile(filePath, { encoding: 'utf8' });
    }

    /**
     * Reads the file content at the given path.
     * Expects utf-8.
     *
     * PLEASE ALWAYS PREFER {@link FsUtilities.readFile} DUE TO PERFORMANCE REASONS.
     * @param filePath - The path of the file to read.
     * @returns The content as a single string.
     */
    static readFileSync(filePath: FsPath): string {
        return readFileSync(filePath, { encoding: 'utf8' });
    }

    /**
     * Same as readFile, but returns the content as an array of lines instead.
     * @param filePath - The path of the file to read the lines from.
     * @returns The content as an array of line strings.
     */
    static async readFileLines(filePath: FsPath): Promise<string[]> {
        const content: string = await this.readFile(filePath);
        return content.split('\n');
    }

    /**
     * Removes either a file or directory.
     * @param entryPath - The path to remove.
     * @param recursive - Whether or not subdirectories should be deleted as well. Defaults to true.
     */
    static async rm(entryPath: FsPath, recursive: boolean = true): Promise<void> {
        if (!await this.exists(entryPath)) {
            return;
        }
        await rm(entryPath, { recursive, force: true });
    }

    /**
     * Removes a directory if it is empty. Nothing happens when it holds anything or does not exist.
     * @param directoryPath - The path of the directory to remove.
     */
    static async rmIfEmpty(directoryPath: FsPath): Promise<void> {
        try {
            // one call rather than a check followed by a removal, so that something added or removed in
            // between cannot make the answer wrong
            await rmdir(directoryPath);
        }
        catch (error) {
            if (this.hasErrorCode(error, 'ENOTEMPTY', 'ENOENT')) {
                return;
            }
            throw error;
        }
    }

    /**
     * Creates a directory at the given path.
     * @param directoryPath - The path of the directory to create.
     * @param recursive - Whether or not missing directories in the path should be created as well. Defaults to true.
     * @returns The first directory it created, the one closest to the root, or undefined when it created none.
     */
    static async mkdir(directoryPath: FsPath, recursive: boolean = true): Promise<FsPath | undefined> {
        const created: string | undefined = await mkdir(directoryPath, { recursive });
        // without recursive, the directory is created or the call throws
        return recursive ? created == undefined ? undefined : this.getPath(created) : directoryPath;
    }

    /**
     * Gets the root level subdirectories and files of the directory at the provided path.
     * @param directoryPath - The path of the directory to get the contents of.
     * @returns An array of the directory contents.
     */
    static async readdir(directoryPath: FsPath): Promise<Dirent[]> {
        return readdir(directoryPath, { withFileTypes: true });
    }
}