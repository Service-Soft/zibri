// Fixture: reports which file `zibri-testing` resolves to inside the worker thread.
//
// An instance runs the copy of the shared packages its parent named, and a thread job has to run the
// same one - a worker that resolves them for itself loads whatever happens to be built, which can be
// an older framework than the instance is running.
import { reportCompletion } from '../../../multithreading/services/worker/helpers';

reportCompletion(require.resolve('zibri-testing'));