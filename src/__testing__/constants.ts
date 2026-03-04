import { FsUtilities, Path } from '../utilities/fs.utilities';

export const testFileFolder: Path = FsUtilities.getPath(__dirname, 'file-output');

export const POSTGRES_TEST_IMAGE: string = 'postgres:17.6';