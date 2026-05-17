import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { type Relation } from 'typeorm';

import { Repository } from './repository';
import { createTestDataSource, defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { startTestServer, StartedTestServer } from '../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';

// ==================== ENTITIES ====================

@Entity()
class Company extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => User, inverseSide: 'company' })
    employees!: User[];
}

@Entity()
class Profile extends BaseEntity {
    @Property.string()
    bio!: string;

    @Property.hasOne({ target: () => User, inverseSide: 'profile' })
    user!: Relation<User>;
}

@Entity()
class Tag extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.manyToMany({ target: () => Post, inverseSide: 'tags', joinTable: false })
    posts!: Post[];
}

@Entity()
class Group extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.manyToMany({ target: () => User, inverseSide: 'groups', joinTable: false })
    members!: User[];
}

@Entity()
class Post extends BaseEntity {
    @Property.string()
    title!: string;

    @Property.manyToOne({ target: () => User, inverseSide: 'posts', joinColumn: 'userId' })
    author!: Relation<User>;

    @Property.oneToMany({ target: () => Comment, inverseSide: 'post' })
    comments!: Relation<Comment>;

    @Property.string({ format: 'uuid' })
    userId!: string;

    @Property.manyToMany({ target: () => Tag, inverseSide: 'posts', joinTable: true })
    tags!: Tag[];
}

@Entity()
class Comment extends BaseEntity {
    @Property.string()
    text!: string;

    @Property.manyToOne({ target: () => Post, inverseSide: 'comments', joinColumn: 'postId' })
    post!: Post;

    @Property.string({ format: 'uuid' })
    postId!: string;
}

@Entity()
class User extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.manyToOne({ target: () => Company, inverseSide: 'employees', joinColumn: 'companyId' })
    company!: Company;

    @Property.string({ format: 'uuid', required: false })
    companyId!: string;

    @Property.oneToMany({ target: () => Post, inverseSide: 'author' })
    posts!: Post[];

    @Property.belongsToOne({ target: () => Profile, inverseSide: 'user', joinColumn: 'profileId' })
    profile!: Profile;

    @Property.string({ format: 'uuid', required: false })
    profileId!: string;

    @Property.manyToMany({ target: () => Group, inverseSide: 'members', joinTable: true })
    groups!: Group[];
}

// ==================== TEST SUITE ====================

let server: StartedTestServer;
let userRepo: Repository<User>;
let companyRepo: Repository<Company>;
let profileRepo: Repository<Profile>;
let postRepo: Repository<Post>;
let tagRepo: Repository<Tag>;
let groupRepo: Repository<Group>;
let commentRepo: Repository<Comment>;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Company, Profile, Tag, Group, Post, Comment, User] })]
    });
    userRepo = inject(repositoryTokenFor(User));
    companyRepo = inject(repositoryTokenFor(Company));
    profileRepo = inject(repositoryTokenFor(Profile));
    postRepo = inject(repositoryTokenFor(Post));
    tagRepo = inject(repositoryTokenFor(Tag));
    groupRepo = inject(repositoryTokenFor(Group));
    commentRepo = inject(repositoryTokenFor(Comment));
}, 15000);

afterAll(async () => {
    await server.shutdown();
});

beforeEach(async () => {
    // Clean all data in reverse dependency order
    await commentRepo.deleteAll({});
    await postRepo.deleteAll({});
    await tagRepo.deleteAll({});
    await userRepo.deleteAll({});
    await groupRepo.deleteAll({});
    await profileRepo.deleteAll({});
    await companyRepo.deleteAll({});
});

// ==================== TESTS ====================

describe('Repository – create with relations', () => {
    it('create with many-to-one (company)', async () => {
        const company: Company = await companyRepo.create({ name: 'Acme' });
        const user: User = await userRepo.create({
            name: 'Alice',
            company: company,
            companyId: company.id
        });
        const fetched: User = await userRepo.findById(user.id);
        expect(fetched.companyId).toBe(company.id);
    });

    it('create with one-to-many (posts)', async () => {
        const user: User = await userRepo.create({ name: 'Bob' });
        await postRepo.create({ title: 'Post 1', author: user, userId: user.id });
        await postRepo.create({ title: 'Post 2', author: user, userId: user.id });
        const fetchedUser: User = await userRepo.findById(user.id, { relations: ['posts'] });
        expect(fetchedUser.posts).toHaveLength(2);
    });

    it('create with many-to-many (tags on post)', async () => {
        const user: User = await userRepo.create({ name: 'Carol' });
        const tag1: Tag = await tagRepo.create({ name: 'tech' });
        const tag2: Tag = await tagRepo.create({ name: 'news' });
        const post: Post = await postRepo.create({
            title: 'Article',
            author: user,
            userId: user.id,
            tags: [tag1, tag2] // many-to-many via relation array
        });
        const fetchedPost: Post = await postRepo.findById(post.id, { relations: ['tags'] });
        expect(fetchedPost.tags).toHaveLength(2);
    });

    it('create with has-one (profile)', async () => {
        const profile: Profile = await profileRepo.create({ bio: 'Hello' });
        const user: User = await userRepo.create({
            name: 'Dan',
            profile: profile,
            profileId: profile.id
        });
        const fetched: User = await userRepo.findById(user.id, { relations: ['profile'] });
        expect(fetched.profile).toBeDefined();
        expect(fetched.profile.bio).toBe('Hello');
    });

    it('create with nested relations', async () => {
        // User -> Post -> Comment
        const user: User = await userRepo.create({ name: 'Eve' });
        const post: Post = await postRepo.create({ title: 'Nested', author: user, userId: user.id });
        const comment: Comment = await commentRepo.create({ text: 'Nice!', post: post, postId: post.id });
        const fetchedComment: Comment = await commentRepo.findById(comment.id, { relations: { post: { author: true } } });
        expect(fetchedComment.post).toBeDefined();
        expect(fetchedComment.post.author).toBeDefined();
    });
});

describe('Repository – update relations', () => {
    it('updateById – change many-to-one', async () => {
        const company1: Company = await companyRepo.create({ name: 'A' });
        const company2: Company = await companyRepo.create({ name: 'B' });
        const user: User = await userRepo.create({ name: 'Frank', company: company1, companyId: company1.id });
        await userRepo.updateById(user.id, { company: company2, companyId: company2.id });
        const updated: User = await userRepo.findById(user.id);
        expect(updated.companyId).toBe(company2.id);
    });

    it('updateById – modify many-to-many array', async () => {
        const user: User = await userRepo.create({ name: 'Grace' });
        const group1: Group = await groupRepo.create({ name: 'Admin' });
        const group2: Group = await groupRepo.create({ name: 'Editor' });
        // Set initial groups via create (known working path)
        await userRepo.updateById(user.id, { groups: [group1] });
        // Now update to add group2
        await userRepo.updateById(user.id, { groups: [group1, group2] });
        const fetched: User = await userRepo.findById(user.id, { relations: ['groups'] });
        expect(fetched.groups).toHaveLength(2);
    });

    it('updateAll – change many-to-one for multiple entities', async () => {
        const companyA: Company = await companyRepo.create({ name: 'Alpha' });
        const companyB: Company = await companyRepo.create({ name: 'Beta' });
        await userRepo.create({ name: 'User1', company: companyA, companyId: companyA.id });
        await userRepo.create({ name: 'User2', company: companyA, companyId: companyA.id });
        await userRepo.updateAll({ companyId: companyA.id }, { company: companyB, companyId: companyB.id });
        const users: User[] = await userRepo.findAll({ where: { companyId: companyB.id } });
        expect(users).toHaveLength(2);
    });

    it('updateAll – modify many-to-many arrays', async () => {
        const group: Group = await groupRepo.create({ name: 'Everyone' });
        const user1: User = await userRepo.create({ name: 'Huey' });
        const user2: User = await userRepo.create({ name: 'Dewey' });
        await userRepo.updateAll({ id: user1.id }, { groups: [group] });
        await userRepo.updateAll({ id: user2.id }, { groups: [group] });
        const fetched: User[] = await userRepo.findAll({ where: { groups: { includes: [group] } } });
        expect(fetched).toHaveLength(2);
    });
});

describe('Repository – delete with relations', () => {
    it('deleteById – with cascade on one-to-many', async () => {
        const user: User = await userRepo.create({ name: 'Ivy' });
        const post: Post = await postRepo.create({ title: 'To be deleted', author: user, userId: user.id });
        // Deleting post should not delete user, but we'll check cascade configuration later
        await postRepo.deleteById(post.id);
        const found: Post | undefined = await postRepo.findOne({ where: { id: post.id } }, false);
        expect(found).toBeUndefined();
        const userStill: User = await userRepo.findById(user.id);
        expect(userStill).toBeDefined();
    });

    it('deleteAll – many-to-many relations are detached, not deleted', async () => {
        const group: Group = await groupRepo.create({ name: 'Temp' });
        const user: User = await userRepo.create({ name: 'Jack', groups: [group] });
        await userRepo.deleteAll({ id: user.id });
        const foundUser: User | undefined = await userRepo.findOne({ where: { id: user.id } }, false);
        expect(foundUser).toBeUndefined();
        const foundGroup: Group = await groupRepo.findById(group.id);
        expect(foundGroup).toBeDefined(); // group not deleted
    });
});

describe('Repository – querying relations', () => {
    it('findById with nested relations', async () => {
        const user: User = await userRepo.create({ name: 'Kate' });
        const post: Post = await postRepo.create({ title: 'Post', author: user, userId: user.id });
        const comment: Comment = await commentRepo.create({ text: 'Yep', post: post, postId: post.id });
        const fetched: Comment = await commentRepo.findById(comment.id, { relations: { post: { author: true } } });
        expect(fetched.post.title).toBe('Post');
        expect(fetched.post.author.name).toBe('Kate');
    });

    it('findAll with where filter on relation property', async () => {
        const company: Company = await companyRepo.create({ name: 'Target' });
        const user: User = await userRepo.create({ name: 'Liam', company: company, companyId: company.id });
        const results: User[] = await userRepo.findAll({ where: { company: { where: { name: 'Target' } } } });
        expect(results.map(u => u.id)).toEqual([user.id]);
    });
});

describe('Repository – combined operations', () => {
    it('createAll with multiple entities and relations', async () => {
        const company: Company = await companyRepo.create({ name: 'MultiCorp' });
        const users: User[] = await userRepo.createAll([
            { name: 'Moe', company: company, companyId: company.id },
            { name: 'Larry', company: company, companyId: company.id },
            { name: 'Curly', company: company, companyId: company.id }
        ]);
        expect(users).toHaveLength(3);
    });
});