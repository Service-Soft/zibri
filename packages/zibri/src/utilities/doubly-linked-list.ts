/**
 * A node inside a DoublyLinkedList.
 * You should never instantiate this directly.
 */
export class LinkedListNode<T> {
    /**
     * The actual value stored inside this node.
     */
    value: T;
    /**
     * The previous list node.
     */
    prev: LinkedListNode<T> | undefined = undefined;
    /**
     * The next list node.
     */
    next: LinkedListNode<T> | undefined = undefined;

    constructor(value: T) {
        this.value = value;
    }
}

/**
 * Generic doubly linked list with O(1) removal of arbitrary nodes
 * and O(1) append / move-to-tail operations.
 */
export class DoublyLinkedList<T> {
    /**
     * The first list element.
     */
    head: LinkedListNode<T> | undefined = undefined;
    /**
     * The last list element.
     */
    tail: LinkedListNode<T> | undefined = undefined;

    private _size: number = 0;

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The amount of elements inside the list.
     */
    get size(): number {
        return this._size;
    }

    /**
     * Appends a value and returns its node (you keep it for later removal).
     * @param value - The value to add.
     * @returns The list node of the just added value.
     */
    addLast(value: T): LinkedListNode<T> {
        const node: LinkedListNode<T> = new LinkedListNode(value);
        if (!this.tail) {
            this.head = this.tail = node;
        }
        else {
            node.prev = this.tail;
            this.tail.next = node;
            this.tail = node;
        }
        this._size++;
        return node;
    }

    /**
     * Removes the given node in O(1).
     * @param node - The node to remove.
     */
    remove(node: LinkedListNode<T>): void {
        if (node.prev) {
            node.prev.next = node.next;
        }
        else {
            this.head = node.next;
        }

        if (node.next) {
            node.next.prev = node.prev;
        }
        else {
            this.tail = node.prev;
        }

        // Prevent accidental reuse
        node.prev = node.next = undefined;
        this._size--;
    }

    /**
     * Moves an existing node to the tail (mark as most recently used).
     * @param node - The node to move to the tail.
     */
    moveToTail(node: LinkedListNode<T>): void {
        if (node === this.tail) {
            return;
        } // already last
        // remove from current position
        if (node.prev) {
            node.prev.next = node.next;
        }
        else {
            this.head = node.next;
        }
        if (node.next) {
            node.next.prev = node.prev;
        }
        else {
            this.tail = node.prev;
        }

        // re-insert at tail
        node.prev = this.tail;
        node.next = undefined;
        if (this.tail) {
            this.tail.next = node;
        }
        else {
            this.head = node;
        }
        this.tail = node;
    }

    /**
     * Clears the list completely.
     */
    clear(): void {
        this.head = this.tail = undefined;
        this._size = 0;
    }
}