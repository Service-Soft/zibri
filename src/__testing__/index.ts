import path from 'path';

export * from './mocks';

export const testFileFolder: string = path.join(__dirname, 'file-output');

export const POSTGRES_TEST_IMAGE: string = 'postgres:17.6';