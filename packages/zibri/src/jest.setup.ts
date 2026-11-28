import console from 'console';

import { beforeAll } from '@jest/globals';
// eslint-disable-next-line eslintImport/no-unassigned-import
import 'reflect-metadata';

import { testVersionsFolder } from './__testing__/constants';
import { PdfmakeTestUtilities } from './__testing__/pdfmake-test.utilities';
import { PdfmakeUtilities } from './document/pdfmake.utilities';
import { FsUtilities } from './utilities/fs.utilities';

global.console = console;

// what an application installs today. 0.2 is still made with by the suites declaring their tests once for each
// version, through PdfmakeTestUtilities
PdfmakeUtilities.packageName = PdfmakeTestUtilities.defaultInstall;

beforeAll(async () => {
    await FsUtilities.mkdir(testVersionsFolder);
}, 30000);