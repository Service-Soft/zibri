import { FsUtilities, FsPath } from '../utilities/fs.utilities';

export const testFileFolder: FsPath = FsUtilities.getPath(__dirname, 'file-output');

export const POSTGRES_TEST_IMAGE: string = 'postgres:17.6';

export const noOp: () => void = () => {};

export const noOpAsync: () => Promise<void> = async () => {};