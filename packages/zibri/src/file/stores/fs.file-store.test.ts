import { afterAll } from '@jest/globals';

import { testFileFolder } from '../../__testing__/constants';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { describeFileStore } from './file-store.cases';
import { FsFileStore } from './fs.file-store';

const folder: FsPath = FsUtilities.getPath(testFileFolder, `fs-file-store-${UUIDUtilities.generate()}`);
const store: FsFileStore = new FsFileStore('fs-file-store', folder);

afterAll(async () => {
    await FsUtilities.rm(folder);
});

describeFileStore('FsFileStore', () => store);