/*
 * Edit mode catalogue. One page per tool section (see EDIT_SECTIONS), each item with a thumbnail (see thumbnails.js).
 * Opens with Tab or the right stick. While the mouse is captured it drives a fake pointer over the page, otherwise
 * it's a normal clickable page. Picking an item closes it.
 *
 * Dispatches `pick` (detail is the tool) and `close`.
 */

// Pointer px per px of mouse movement.
const POINTER_SPEED = 1;

export class Catalogue extends EventTarget {
    /**
     * @param {HTMLElement} root The catalogue's element (see index.html).
     * @param {import('./thumbnails.js').Thumbnails} thumbnails
     */
    constructor(root, thumbnails) {
        super();
        this.root = root;
        this.thumbnails = thumbnails;
        this.tabs = /** @type {HTMLElement} */ (root.querySelector('.catalogue-tabs'));
        this.grid = /** @type {HTMLElement} */ (root.querySelector('.catalogue-grid'));
        this.hint = /** @type {HTMLElement} */ (root.querySelector('.catalogue-hint'));
        this.pointer = /** @type {HTMLElement} */ (root.querySelector('.catalogue-pointer'));
        /** @type {readonly import('../player/EditTool.js').EditSection[]} */
        this.sections = [];
        this.page = 0;
        this.index = 0;
        /** Tool in hand when opened. */
        this.current = '';
        // Fake pointer position, only used while the mouse is captured.
        this._pointer = { x: 0, y: 0 };
        this._captured = false;

        this.tabs.addEventListener('click', (event) => {
            const tab = /** @type {HTMLElement} */ (event.target).closest?.('[data-page]');
            if (tab) this.showPage(Number(tab.getAttribute('data-page')));
        });
        this.grid.addEventListener('click', (event) => {
            const item = /** @type {HTMLElement} */ (event.target).closest?.('[data-tool]');
            if (item) this._choose(/** @type {string} */ (item.getAttribute('data-tool')));
        });
        this.grid.addEventListener('pointerover', (event) => {
            const item = /** @type {HTMLElement} */ (event.target).closest?.('[data-index]');
            if (item && !this._captured) this._select(Number(item.getAttribute('data-index')), false);
        });
        root.addEventListener('click', (event) => {
            // Close button or a click outside the panel.
            if (event.target === root || /** @type {HTMLElement} */ (event.target).closest?.('[data-action="close"]')) this.close();
        });
    }

    get isOpen() {
        return !this.root.hidden;
    }

    /**
     * Opens on the page with the current tool.
     * @param {readonly import('../player/EditTool.js').EditSection[]} sections
     * @param {string} current
     * @param {object} options
     * @param {boolean} options.captured Mouse is captured, so use our own pointer.
     * @param {string} options.hint Controls text for the footer.
     */
    open(sections, current, { captured, hint }) {
        this.sections = sections;
        this.current = current;
        this._captured = captured;
        this.hint.textContent = hint;
        this.root.hidden = false;
        this.root.classList.toggle('captured', captured);
        this.tabs.innerHTML = sections.map((section, k) => `<button type="button" class="tab" role="tab" data-page="${k}">${section.name ?? 'Walls'}</button>`).join('');
        const page = Math.max(sections.findIndex((section) => section.tools.includes(current)), 0);
        this.showPage(page, sections[page].tools.indexOf(current));
        // Pointer starts centered. The current tool stays selected until the pointer moves.
        this._pointer.x = innerWidth / 2;
        this._pointer.y = innerHeight / 2;
        this._movePointer(0, 0, false);
    }

    close() {
        if (!this.isOpen) return;
        this.root.hidden = true;
        this.grid.innerHTML = '';
        this.dispatchEvent(new Event('close'));
    }

    /**
     * Shows one section's tools.
     * @param {number} page
     * @param {number} [index] Item to select.
     */
    showPage(page, index = 0) {
        const count = this.sections.length;
        this.page = ((page % count) + count) % count;
        for (const tab of this.tabs.children) tab.setAttribute('aria-selected', String(Number(tab.getAttribute('data-page')) === this.page));
        const tools = this.sections[this.page].tools;
        this.grid.replaceChildren(...tools.map((tool, k) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'catalogue-item';
            item.dataset.tool = tool;
            item.dataset.index = String(k);
            item.setAttribute('role', 'option');
            if (tool === this.current) item.classList.add('current');
            const name = document.createElement('span');
            name.textContent = tool;
            item.append(this.thumbnails.picture(tool), name);
            return item;
        }));
        this._select(Math.max(0, Math.min(index, tools.length - 1)));
    }

    /**
     * Next page, or previous with -1.
     * @param {number} direction
     */
    turnPage(direction) {
        this.showPage(this.page + direction);
    }

    /**
     * Moves the selection sideways (dx) or by rows (dy).
     * @param {number} dx
     * @param {number} dy
     */
    move(dx, dy) {
        const items = /** @type {HTMLElement[]} */ ([...this.grid.children]);
        if (items.length === 0) return;
        if (dx !== 0) {
            this._select(Math.max(0, Math.min(this.index + dx, items.length - 1)));
            return;
        }
        // Closest item horizontally in the next or previous row.
        const from = items[this.index].getBoundingClientRect();
        let best = -1;
        let bestScore = Infinity;
        items.forEach((item, k) => {
            const rect = item.getBoundingClientRect();
            const down = rect.top - from.top;
            if (Math.sign(down) !== Math.sign(dy) || Math.abs(down) < 2) return;
            const score = Math.abs(down) * 4 + Math.abs(rect.left - from.left);
            if (score < bestScore) {
                bestScore = score;
                best = k;
            }
        });
        if (best >= 0) this._select(best);
    }

    /** Picks the selected item. */
    confirm() {
        const item = this.grid.children[this.index];
        if (item) this._choose(/** @type {string} */ (item.getAttribute('data-tool')));
    }

    /**
     * Moves the fake pointer by the mouse movement (px) and selects what's under it.
     * @param {number} dx
     * @param {number} dy
     */
    movePointer(dx, dy) {
        this._movePointer(dx * POINTER_SPEED, dy * POINTER_SPEED);
    }

    /** Captured mouse click at the fake pointer (tab, item or Close). */
    click() {
        const under = /** @type {HTMLElement | null} */ (document.elementFromPoint(this._pointer.x, this._pointer.y));
        const tab = under?.closest?.('[data-page]');
        if (tab) {
            this.showPage(Number(tab.getAttribute('data-page')));
            return;
        }
        const item = under?.closest?.('[data-tool]');
        if (item) {
            this._choose(/** @type {string} */ (item.getAttribute('data-tool')));
            return;
        }
        if (under?.closest?.('[data-action="close"]')) this.close();
    }

    /**
     * Mouse wheel moves the selection a row at a time.
     * @param {number} direction
     */
    scroll(direction) {
        this.move(0, direction);
    }

    /** @param {boolean} [pick] Select what's under the pointer. */
    _movePointer(dx, dy, pick = true) {
        const pointer = this._pointer;
        pointer.x = Math.min(Math.max(pointer.x + dx, 0), innerWidth - 1);
        pointer.y = Math.min(Math.max(pointer.y + dy, 0), innerHeight - 1);
        this.pointer.style.transform = `translate(${pointer.x}px, ${pointer.y}px)`;
        if (!this._captured || !pick) return;
        const item = /** @type {HTMLElement | null} */ (document.elementFromPoint(pointer.x, pointer.y))?.closest?.('[data-index]');
        if (item) this._select(Number(item.getAttribute('data-index')), false);
    }

    /**
     * @param {number} index
     * @param {boolean} [scroll] Scroll into view. Not needed when the pointer is over it.
     */
    _select(index, scroll = true) {
        const items = this.grid.children;
        items[this.index]?.classList.remove('selected');
        items[this.index]?.setAttribute('aria-selected', 'false');
        this.index = index;
        const item = items[index];
        if (!item) return;
        item.classList.add('selected');
        item.setAttribute('aria-selected', 'true');
        if (scroll) item.scrollIntoView({ block: 'nearest' });
    }

    _choose(tool) {
        this.dispatchEvent(new CustomEvent('pick', { detail: tool }));
        this.close();
    }
}
