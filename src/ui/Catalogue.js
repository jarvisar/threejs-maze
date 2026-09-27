/*
 * Edit mode's catalogue: everything there is to build or put down, a page for each section of the tools (see
 * EDIT_SECTIONS), each with its picture (see thumbnails.js). Opened with Tab (a controller's right stick), it takes the
 * keys, the stick and the mouse while it's up: with the mouse captured (as it is while playing), moving it moves a
 * pointer of its own over the page; otherwise the page is clicked or tapped like any other. Choosing one closes it.
 *
 * Dispatches `pick` (the tool chosen, as its detail) and `close`.
 */

// How far the pointer moves for the mouse's movement: as far as the mouse would move it over the page.
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
        /** The tool in hand when it was opened. */
        this.current = '';
        // Where the pointer is on the screen, while the mouse is captured (else it's the real one).
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
            // Close, or anywhere off the panel.
            if (event.target === root || /** @type {HTMLElement} */ (event.target).closest?.('[data-action="close"]')) this.close();
        });
    }

    get isOpen() {
        return !this.root.hidden;
    }

    /**
     * Opens on the page with the tool in hand.
     * @param {readonly import('../player/EditTool.js').EditSection[]} sections
     * @param {string} current
     * @param {object} options
     * @param {boolean} options.captured Whether the mouse is captured (the catalogue has a pointer of its own then).
     * @param {string} options.hint What the keys or buttons are, for the foot of it.
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
        // The pointer starts in the middle.
        this._pointer.x = innerWidth / 2;
        this._pointer.y = innerHeight / 2;
        this._movePointer(0, 0);
    }

    close() {
        if (!this.isOpen) return;
        this.root.hidden = true;
        this.grid.innerHTML = '';
        this.dispatchEvent(new Event('close'));
    }

    /**
     * A page of the catalogue: one section's tools.
     * @param {number} page
     * @param {number} [index] Which to have picked out.
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
     * The next page (−1: the one before).
     * @param {number} direction
     */
    turnPage(direction) {
        this.showPage(this.page + direction);
    }

    /**
     * Moves what's picked out across the grid (dx) or up and down it (dy), a row at a time.
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
        // The item in the next row (or the one before) that's nearest across from this one.
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

    /** Chooses what's picked out. */
    confirm() {
        const item = this.grid.children[this.index];
        if (item) this._choose(/** @type {string} */ (item.getAttribute('data-tool')));
    }

    /**
     * The captured mouse moving the pointer (by its movement, in pixels); what it's over is picked out.
     * @param {number} dx
     * @param {number} dy
     */
    movePointer(dx, dy) {
        this._movePointer(dx * POINTER_SPEED, dy * POINTER_SPEED);
    }

    /** The captured mouse clicking: on a tab, an item, or Close, where the pointer is. */
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
     * The mouse's wheel over the catalogue: through the page a row at a time.
     * @param {number} direction
     */
    scroll(direction) {
        this.move(0, direction);
    }

    _movePointer(dx, dy) {
        const pointer = this._pointer;
        pointer.x = Math.min(Math.max(pointer.x + dx, 0), innerWidth - 1);
        pointer.y = Math.min(Math.max(pointer.y + dy, 0), innerHeight - 1);
        this.pointer.style.transform = `translate(${pointer.x}px, ${pointer.y}px)`;
        if (!this._captured) return;
        const item = /** @type {HTMLElement | null} */ (document.elementFromPoint(pointer.x, pointer.y))?.closest?.('[data-index]');
        if (item) this._select(Number(item.getAttribute('data-index')), false);
    }

    /**
     * @param {number} index
     * @param {boolean} [scroll] Scroll it into view (not while the pointer's over it: it's in view).
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
