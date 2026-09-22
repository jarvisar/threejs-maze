/**
 * The settings screen, laid out like a camcorder's on-screen menu: pages of rows, one of them highlighted,
 * changed with the arrow keys or the mouse.
 *
 * @typedef {object} MenuItem
 * @property {'toggle' | 'range' | 'choice' | 'action' | 'info' | 'text' | 'heading'} type
 * @property {string} label
 * @property {string} [path] Setting it controls, e.g. "graphics.fpsLimit".
 * @property {string} [id] Action/text rows: what to report to onAction.
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {(value: number) => string} [format]
 * @property {[number, string][]} [options] For choices: [value, label] pairs.
 * @property {string} [dependsOn] Path of a toggle; the row is dimmed while that's off.
 * @property {() => string} [value] For info rows.
 *
 * @typedef {{ title: string, items: MenuItem[] }} MenuPage
 */

const SEGMENTS = 12;

export class SettingsMenu extends EventTarget {
    /**
     * @param {HTMLElement} root
     * @param {object} settings
     * @param {MenuPage[]} pages
     * @param {{ onChange: (path: string) => void, onAction: (id: string, value?: string) => void }} callbacks
     */
    constructor(root, settings, pages, callbacks) {
        super();
        this.root = root;
        this.settings = settings;
        this.pages = pages;
        this.callbacks = callbacks;
        this.page = 0;
        this.selected = 0;

        root.tabIndex = -1;
        root.innerHTML = `
            <header class="panel-header">
                <h2>Settings</h2>
                <nav class="tabs" role="tablist"></nav>
            </header>
            <div class="rows" role="list"></div>
            <footer class="panel-footer">
                <span class="panel-hint">Arrow keys to change, Tab for the next page</span>
                <button type="button" class="link" data-action="back">Back</button>
            </footer>`;
        this.tabs = /** @type {HTMLElement} */ (root.querySelector('.tabs'));
        this.list = /** @type {HTMLElement} */ (root.querySelector('.rows'));

        this.tabs.addEventListener('click', (event) => {
            const tab = /** @type {HTMLElement} */ (event.target).closest('[data-page]');
            if (tab) this.showPage(Number(tab.getAttribute('data-page')));
        });
        this.list.addEventListener('pointerover', (event) => {
            const row = /** @type {HTMLElement} */ (event.target).closest('[data-index]');
            if (row) this._select(Number(row.getAttribute('data-index')), false);
        });
        this.list.addEventListener('click', (event) => this._onClick(event));
        this.list.addEventListener('pointerdown', (event) => this._onPointerDown(event));
        window.addEventListener('keydown', (event) => this._onKeyDown(event));
    }

    get isOpen() {
        return !this.root.hidden;
    }

    open() {
        this.root.hidden = false;
        this._render();
        this.root.focus({ preventScroll: true });
    }

    close() {
        this.root.hidden = true;
    }

    /** Redraws the values (after settings were changed elsewhere, e.g. by a keyboard shortcut). */
    refresh() {
        if (this.isOpen) this._renderRows();
    }

    showPage(index) {
        this.page = (index + this.pages.length) % this.pages.length;
        this.selected = this._selectable().find((i) => i >= 0) ?? 0;
        this._render();
    }

    // ------------------------------------------------------------------ rendering

    _render() {
        this.tabs.innerHTML = this.pages
            .map((page, i) => `<button type="button" role="tab" class="tab" data-page="${i}" aria-selected="${i === this.page}">${page.title}</button>`)
            .join('');
        this._renderRows();
    }

    _renderRows() {
        const items = this.pages[this.page].items;
        const input = this.list.querySelector('input');
        const typing = input !== null && document.activeElement === input;
        if (typing) {
            // Don't rebuild the row being typed into.
            for (const row of this.list.querySelectorAll('[data-index]')) {
                const index = Number(row.getAttribute('data-index'));
                if (items[index].type !== 'text') row.outerHTML = this._rowHtml(items[index], index);
            }
            return;
        }
        this.list.innerHTML = items.map((item, i) => this._rowHtml(item, i)).join('');
    }

    _rowHtml(item, index) {
        if (item.type === 'heading') return `<div class="row-heading" data-heading>${item.label}</div>`;
        const selected = index === this.selected;
        const dimmed = item.dependsOn && !this._get(item.dependsOn);
        const classes = ['row', selected ? 'selected' : '', dimmed ? 'dimmed' : ''].join(' ');
        const arrows = (inner) => `<button type="button" class="arrow" data-step="-1" tabindex="-1" aria-label="Less">&lsaquo;</button>${inner}<button type="button" class="arrow" data-step="1" tabindex="-1" aria-label="More">&rsaquo;</button>`;
        let value = '';
        switch (item.type) {
            case 'toggle':
                value = arrows(`<span class="value-text">${this._get(item.path) ? 'On' : 'Off'}</span>`);
                break;
            case 'range': {
                const v = this._get(item.path);
                const filled = Math.round(((v - item.min) / (item.max - item.min)) * SEGMENTS);
                let bar = '';
                for (let s = 0; s < SEGMENTS; s++) bar += `<i class="${s < filled ? 'on' : ''}"></i>`;
                value = arrows(`<span class="bar" data-bar>${bar}</span><span class="value-text value-number">${item.format ? item.format(v) : v}</span>`);
                break;
            }
            case 'choice': {
                const v = this._get(item.path);
                const option = item.options.find(([optionValue]) => optionValue === v);
                value = arrows(`<span class="value-text">${option ? option[1] : v}</span>`);
                break;
            }
            case 'info':
                value = `<span class="value-text">${item.value()}</span>`;
                break;
            case 'text':
                value = `<input class="text-input" type="text" maxlength="40" spellcheck="false" autocomplete="off" placeholder="${item.placeholder ?? ''}" aria-label="${item.label}">`;
                break;
            default:
                value = '<span class="value-text">&raquo;</span>';
        }
        return `<div class="${classes}" data-index="${index}" role="listitem"><span class="row-label">${item.label}</span><span class="row-value">${value}</span></div>`;
    }

    // ------------------------------------------------------------------ interaction

    _selectable() {
        return this.pages[this.page].items.map((item, i) => (item.type === 'heading' ? -1 : i)).filter((i) => i >= 0);
    }

    /**
     * @param {number} index
     * @param {boolean} fromKeyboard Keyboard selection scrolls the row into view and moves the text cursor
     *     into (or out of) text rows; hovering with the mouse leaves focus alone.
     */
    _select(index, fromKeyboard = true) {
        if (index === this.selected) return;
        this.selected = index;
        for (const row of this.list.querySelectorAll('[data-index]')) {
            row.classList.toggle('selected', Number(row.getAttribute('data-index')) === index);
        }
        if (!fromKeyboard) return;
        const row = this.list.querySelector(`[data-index="${index}"]`);
        row?.scrollIntoView({ block: 'nearest' });
        const input = row?.querySelector('input');
        if (input) input.focus();
        else if (document.activeElement?.tagName === 'INPUT') this.root.focus({ preventScroll: true });
    }

    _moveSelection(direction) {
        const selectable = this._selectable();
        const position = selectable.indexOf(this.selected);
        const next = selectable[Math.min(Math.max(position + direction, 0), selectable.length - 1)];
        if (next !== undefined) this._select(next);
    }

    /** Changes the selected row's value one step (or activates it). */
    _adjust(index, direction) {
        const item = this.pages[this.page].items[index];
        switch (item.type) {
            case 'toggle':
                this._set(item.path, !this._get(item.path));
                break;
            case 'range': {
                const v = this._get(item.path);
                this._set(item.path, clampStep(v + direction * item.step, item));
                break;
            }
            case 'choice': {
                const values = item.options.map(([value]) => value);
                const current = values.indexOf(this._get(item.path));
                this._set(item.path, values[(current + direction + values.length) % values.length]);
                break;
            }
            case 'action':
                if (direction > 0) this.callbacks.onAction(item.id);
                break;
            default:
        }
    }

    _onClick(event) {
        const target = /** @type {HTMLElement} */ (event.target);
        const row = target.closest('[data-index]');
        if (!row || target.closest('[data-bar]')) return;
        const index = Number(row.getAttribute('data-index'));
        const item = this.pages[this.page].items[index];
        const arrow = target.closest('[data-step]');
        if (arrow) this._adjust(index, Number(arrow.getAttribute('data-step')));
        else if (item.type === 'toggle' || item.type === 'choice' || item.type === 'action') this._adjust(index, 1);
    }

    /** Clicking or dragging along a slider's bar sets it directly. */
    _onPointerDown(event) {
        const bar = /** @type {HTMLElement} */ (event.target).closest('[data-bar]');
        if (!bar) return;
        const index = Number(bar.closest('[data-index]').getAttribute('data-index'));
        const item = this.pages[this.page].items[index];
        const setFrom = (clientX) => {
            // Re-query: the row is re-rendered on every change.
            const current = this.list.querySelector(`[data-index="${index}"] [data-bar]`) ?? bar;
            const rect = current.getBoundingClientRect();
            const fraction = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
            this._set(item.path, clampStep(item.min + fraction * (item.max - item.min), item));
        };
        setFrom(event.clientX);
        const move = (e) => setFrom(e.clientX);
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        event.preventDefault();
    }

    _onKeyDown(event) {
        if (!this.isOpen) return;
        const input = /** @type {HTMLElement} */ (event.target).closest?.('input');
        if (input) {
            if (event.key === 'Enter') {
                // The row the text is in (the mouse may have wandered to another row since).
                const index = Number(input.closest('[data-index]').getAttribute('data-index'));
                const item = this.pages[this.page].items[index];
                this.callbacks.onAction(item.id, /** @type {HTMLInputElement} */ (input).value);
                /** @type {HTMLInputElement} */ (input).value = '';
                event.preventDefault();
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                this._moveSelection(event.key === 'ArrowUp' ? -1 : 1);
                event.preventDefault();
            } else if (event.key === 'Escape') {
                this.root.focus({ preventScroll: true });
                event.preventDefault();
            }
            return;
        }
        switch (event.key) {
            case 'ArrowUp':
                this._moveSelection(-1);
                break;
            case 'ArrowDown':
                this._moveSelection(1);
                break;
            case 'ArrowLeft':
                this._adjust(this.selected, -1);
                break;
            case 'ArrowRight':
                this._adjust(this.selected, 1);
                break;
            case 'Enter':
            case ' ':
                this._adjust(this.selected, 1);
                break;
            case 'Tab':
            case 'PageDown':
            case 'PageUp':
                this.showPage(this.page + (event.shiftKey || event.key === 'PageUp' ? -1 : 1));
                break;
            case 'Escape':
            case 'Backspace':
                this.dispatchEvent(new Event('close'));
                break;
            default:
                return;
        }
        event.preventDefault();
    }

    _get(path) {
        return path.split('.').reduce((object, key) => object[key], this.settings);
    }

    _set(path, value) {
        const keys = path.split('.');
        const last = keys.pop();
        const object = keys.reduce((o, key) => o[key], this.settings);
        if (object[last] === value) return;
        object[last] = value;
        this.callbacks.onChange(path);
        this._renderRows();
    }
}

function clampStep(value, { min, max, step }) {
    const stepped = Math.round((value - min) / step) * step + min;
    // Round away float noise from the step arithmetic (0.1 + 0.2 and friends).
    return Number(Math.min(Math.max(stepped, min), max).toFixed(6));
}
