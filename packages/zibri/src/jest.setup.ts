import console from 'console';

import { beforeAll } from '@jest/globals';
// eslint-disable-next-line eslintImport/no-unassigned-import
import 'reflect-metadata';

import { testVersionsFolder } from './__testing__/constants';
import { FsUtilities } from './utilities/fs.utilities';

global.console = console;

beforeAll(async () => {
    await FsUtilities.mkdir(testVersionsFolder);
});