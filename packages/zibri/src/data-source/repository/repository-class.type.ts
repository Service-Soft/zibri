import { Newable } from '../../types/newable.type';

/**
 * A repository class of any entity, as a data source lists them in its `repositories`: a class
 * declared with `@RepositoryFor`, which the application checks while it starts.
 */
// any class rather than a repository type, because a repository takes the rows of its entity in and
// hands them out: Repository<T> is invariant in T, so no repository of an entity is a
// Repository<BaseEntity>, and neither any nor never as T gives a type every repository is. That the
// class is a repository is what @RepositoryFor types and the start checks
export type RepositoryClass = Newable<object>;
