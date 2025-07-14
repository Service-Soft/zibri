import { PathLike } from 'fs';
import { access } from 'fs/promises';

/**
 * Checks if the file/folder at the given path exists.
 * @param path - The path to check.
 * @returns True when the path was found, false otherwise.
 */
export async function pathExists(path: PathLike): Promise<boolean> {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}