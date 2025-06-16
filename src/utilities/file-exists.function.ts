import { accessSync, PathLike } from 'fs';
import { access } from 'fs/promises';

export async function fileExists(path: PathLike): Promise<boolean> {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}

export function fileExistsSync(path: PathLike): boolean {
    try {
        accessSync(path);
        return true;
    }
    catch {
        return false;
    }
}