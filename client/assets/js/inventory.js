/**
 * inventory.js  —  Physical inventory HUD
 *
 * Renders a bottom-center slot bar showing available powerups and their keybinds.
 * Each slot is a pure keybind indicator — no client-side cooldown ring.
 * Cooldowns / spawn rules are enforced server-side only.
 *
 * Adding a new powerup later:
 *   1. Push a new entry into INVENTORY_SLOTS
 *   2. The bar auto-expands
 */

(function () {
    'use strict';

    /* ── Slot definitions ───────────────────────────────────────────────────
     *  id      : unique string key
     *  icon    : emoji displayed in the slot
     *  label   : short name shown under icon
     *  key     : keyboard label shown top-right
     *  keyCode : JS keyCode that triggers this slot
     *  onUse   : function called when the slot is activated
     * ─────────────────────────────────────────────────────────────────────── */
    var INVENTORY_SLOTS = [
        {
            id:      'growth',
            icon:    '🌱',
            label:   'Growth',
            key:     '3',
            keyCode: 51,
            onUse: function () {
                // Sends opcode 28 → server spawns a GrowthPellet entity at cursor.
                // No client-side cooldown: the pellet is physical, no UI timer needed.
                if (typeof sendMouseMove === 'function') sendMouseMove();
                if (typeof sendUint8    === 'function') sendUint8(28);
            }
        }
        /* ← future powerups go here */
    ];

    /* ── Internal state ─────────────────────────────────────────────────── */
    var dragSlotId       = null;
    var inventoryVisible = false;

    /* ── DOM refs (populated in init) ──────────────────────────────────────*/
    var invEl   = null;
    var ghostEl = null;

    /* ── Build the DOM once ─────────────────────────────────────────────── */
    function buildSlots() {
        invEl.innerHTML = '';
        INVENTORY_SLOTS.forEach(function (slot) {
            var div = document.createElement('div');
            div.className = 'inv-slot';
            div.id        = 'inv-slot-' + slot.id;
            div.draggable = true;
            div.title     = slot.label + ' (press ' + slot.key + ' or drag to map)';
            div.innerHTML =
                '<span class="slot-key">'   + slot.key   + '</span>' +
                '<span class="slot-icon">'  + slot.icon  + '</span>' +
                '<span class="slot-label">' + slot.label + '</span>';

            /* drag start */
            div.addEventListener('dragstart', function (e) {
                dragSlotId = slot.id;
                ghostEl.innerHTML     = slot.icon;
                ghostEl.style.display = 'flex';
                var img = new Image();
                img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                e.dataTransfer.setDragImage(img, 0, 0);
                e.dataTransfer.effectAllowed = 'move';
            });

            div.addEventListener('dragend', function () {
                dragSlotId = null;
                ghostEl.style.display = 'none';
            });

            invEl.appendChild(div);
        });
    }

    /* ── Canvas drop zone ───────────────────────────────────────────────── */
    function bindCanvasDrop() {
        var canvas = document.getElementById('canvas');
        if (!canvas) return;

        canvas.addEventListener('dragover', function (e) {
            if (dragSlotId) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            }
        });

        canvas.addEventListener('drop', function (e) {
            e.preventDefault();
            if (!dragSlotId) return;
            var slot = slotById(dragSlotId);
            if (slot) activateSlot(slot);
            dragSlotId = null;
            ghostEl.style.display = 'none';
        });
    }

    /* ── Mouse-following ghost during drag ──────────────────────────────── */
    function bindGhostFollow() {
        document.addEventListener('dragover', function (e) {
            if (dragSlotId) {
                ghostEl.style.left = e.clientX + 'px';
                ghostEl.style.top  = e.clientY + 'px';
            }
        });
    }

    /* ── Keyboard handler ───────────────────────────────────────────────── */
    function onKeyDown(e) {
        // Block if the main menu/overlay is showing (hasOverlay is set by main_out.js).
        // Do NOT gate on inventoryVisible — the HUD visibility must not prevent the
        // packet from being sent; that was the bug causing key 3 to silently do nothing.
        if (typeof hasOverlay !== 'undefined' && hasOverlay) return;
        var active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

        INVENTORY_SLOTS.forEach(function (slot) {
            if (e.keyCode === slot.keyCode) activateSlot(slot);
        });
    }

    /* ── Activate a slot ────────────────────────────────────────────────── */
    function activateSlot(slot) {
        slot.onUse();
        flashSlot(slot.id);
    }

    /* ── Visual flash on activation ─────────────────────────────────────── */
    function flashSlot(id) {
        var el = document.getElementById('inv-slot-' + id);
        if (!el) return;
        el.classList.remove('active');
        void el.offsetWidth;
        el.classList.add('active');
        setTimeout(function () { el.classList.remove('active'); }, 400);
    }

    /* ── Utility ─────────────────────────────────────────────────────────── */
    function slotById(id) {
        for (var i = 0; i < INVENTORY_SLOTS.length; i++) {
            if (INVENTORY_SLOTS[i].id === id) return INVENTORY_SLOTS[i];
        }
        return null;
    }

    /* ── Show / hide the bar (called from game loop) ────────────────────── */
    window.inventoryShow = function () {
        if (inventoryVisible) return;
        inventoryVisible = true;
        if (invEl) invEl.style.display = 'flex';
    };

    window.inventoryHide = function () {
        if (!inventoryVisible) return;
        inventoryVisible = false;
        if (invEl) invEl.style.display = 'none';
    };

    /* Called once per animation frame from main_out.js — no-op now (no rings to draw) */
    window.inventoryTick = function () { /* nothing to tick — cooldowns are server-side */ };

    /* ── Init ────────────────────────────────────────────────────────────── */
    function init() {
        invEl   = document.getElementById('inventory');
        ghostEl = document.getElementById('inv-drag-ghost');
        if (!invEl || !ghostEl) return;

        buildSlots();
        bindCanvasDrop();
        bindGhostFollow();
        window.addEventListener('keydown', onKeyDown);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

}());
