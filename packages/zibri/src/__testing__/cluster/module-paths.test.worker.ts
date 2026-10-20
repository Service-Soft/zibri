// Fixture: reports which files the shared packages resolve to inside a worker thread of a cluster
// instance - a thread never runs the instance's entry, so it gets the parent's copies only if the
// preload reached it.
import { reportCompletion } from '../../multithreading/services/worker/helpers.ts';

reportCompletion([import.meta.resolve('zibri'), import.meta.resolve('zibri-testing')].join(' '));
