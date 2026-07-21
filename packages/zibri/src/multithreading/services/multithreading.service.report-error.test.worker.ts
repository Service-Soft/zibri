// Fixture: reports a failure via reportError() directly, instead of throwing synchronously
// (that path is already covered by multithreading.service.throwing.test.worker.ts).
import { reportError } from './worker/helpers';

reportError(new Error('worker fixture: reported via reportError()'));