import { FsUtilities, Path } from '../utilities';

export * from './mocks';

export const testFileFolder: Path = FsUtilities.getPath(__dirname, 'file-output');

export const POSTGRES_TEST_IMAGE: string = 'postgres:17.6';