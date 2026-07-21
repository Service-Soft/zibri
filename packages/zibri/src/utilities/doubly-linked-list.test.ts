import { describe, expect, it } from '@jest/globals';

import { DoublyLinkedList, LinkedListNode } from './doubly-linked-list';

function toArray<T>(list: DoublyLinkedList<T>): T[] {
    const values: T[] = [];
    let node: LinkedListNode<T> | undefined = list.head;
    while (node) {
        values.push(node.value);
        node = node.next;
    }
    return values;
}

describe('DoublyLinkedList', () => {
    it('starts empty', () => {
        const list: DoublyLinkedList<number> = new DoublyLinkedList();
        expect(list.size).toBe(0);
        expect(list.head).toBeUndefined();
        expect(list.tail).toBeUndefined();
    });

    describe('addLast', () => {
        it('sets head and tail to the same node for the first item', () => {
            const list: DoublyLinkedList<number> = new DoublyLinkedList();
            const node: LinkedListNode<number> = list.addLast(1);
            expect(list.head).toBe(node);
            expect(list.tail).toBe(node);
            expect(list.size).toBe(1);
        });

        it('appends subsequent items to the tail, preserving order', () => {
            const list: DoublyLinkedList<number> = new DoublyLinkedList();
            list.addLast(1);
            list.addLast(2);
            list.addLast(3);
            expect(toArray(list)).toEqual([1, 2, 3]);
            expect(list.size).toBe(3);
        });
    });

    describe('remove', () => {
        it('removes the head node', () => {
            const list: DoublyLinkedList<number> = new DoublyLinkedList();
            const a: LinkedListNode<number> = list.addLast(1);
            list.addLast(2);
            list.addLast(3);

            list.remove(a);

            expect(toArray(list)).toEqual([2, 3]);
            expect(list.head?.value).toBe(2);
            expect(list.size).toBe(2);
        });

        it('removes the tail node', () => {
            const list: DoublyLinkedList<number> = new DoublyLinkedList();
            list.addLast(1);
            list.addLast(2);
            const c: LinkedListNode<number> = list.addLast(3);

            list.remove(c);

            expect(toArray(list)).toEqual([1, 2]);
            expect(list.tail?.value).toBe(2);
            expect(list.size).toBe(2);
        });

        it('removes a middle node', () => {
            const list: DoublyLinkedList<number> = new DoublyLinkedList();
            list.addLast(1);
            const b: LinkedListNode<number> = list.addLast(2);
            list.addLast(3);

            list.remove(b);

            expect(toArray(list)).toEqual([1, 3]);
            expect(list.size).toBe(2);
        });

        it('removing the only element leaves the list empty (head and tail undefined)', () => {
            const list: DoublyLinkedList<number> = new DoublyLinkedList();
            const only: LinkedListNode<number> = list.addLast(1);

            list.remove(only);

            expect(list.head).toBeUndefined();
            expect(list.tail).toBeUndefined();
            expect(list.size).toBe(0);
        });

        it('clears the removed node\'s prev/next pointers to prevent accidental reuse', () => {
            const list: DoublyLinkedList<number> = new DoublyLinkedList();
            list.addLast(1);
            const b: LinkedListNode<number> = list.addLast(2);
            list.addLast(3);

            list.remove(b);

            expect(b.prev).toBeUndefined();
            expect(b.next).toBeUndefined();
        });
    });

    describe('moveToTail', () => {
        it('is a no-op when the node is already the tail', () => {
            const list: DoublyLinkedList<number> = new DoublyLinkedList();
            list.addLast(1);
            const c: LinkedListNode<number> = list.addLast(2);

            list.moveToTail(c);

            expect(toArray(list)).toEqual([1, 2]);
            expect(list.tail).toBe(c);
        });

        it('moves the head node to the tail', () => {
            const list: DoublyLinkedList<number> = new DoublyLinkedList();
            const a: LinkedListNode<number> = list.addLast(1);
            list.addLast(2);
            list.addLast(3);

            list.moveToTail(a);

            expect(toArray(list)).toEqual([2, 3, 1]);
            expect(list.head?.value).toBe(2);
            expect(list.tail).toBe(a);
        });

        it('moves a middle node to the tail', () => {
            const list: DoublyLinkedList<number> = new DoublyLinkedList();
            list.addLast(1);
            const b: LinkedListNode<number> = list.addLast(2);
            list.addLast(3);

            list.moveToTail(b);

            expect(toArray(list)).toEqual([1, 3, 2]);
            expect(list.tail).toBe(b);
        });

        it('moving the only node to the tail keeps it as the sole element', () => {
            const list: DoublyLinkedList<number> = new DoublyLinkedList();
            const only: LinkedListNode<number> = list.addLast(1);

            list.moveToTail(only);

            expect(toArray(list)).toEqual([1]);
            expect(list.head).toBe(only);
            expect(list.tail).toBe(only);
        });
    });

    describe('clear', () => {
        it('empties the list and resets size', () => {
            const list: DoublyLinkedList<number> = new DoublyLinkedList();
            list.addLast(1);
            list.addLast(2);

            list.clear();

            expect(list.head).toBeUndefined();
            expect(list.tail).toBeUndefined();
            expect(list.size).toBe(0);
        });
    });
});