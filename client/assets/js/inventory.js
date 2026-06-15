/**
 * inventory.js  —  Physical inventory HUD
 *
 * Renders a bottom-center slot bar.  Each slot can:
 *   - Be activated by its assigned hotkey
 *   - Be dragged from the inventory and dropped onto the canvas
 *
 * Adding a new powerup later:
 *   1. Push a new entry into INVENTORY_SLOTS
 *   2. The bar auto-expands
 */

(function () {
    'use strict';

    /* ── Slot definitions ───────────────────────────────────────────────────
     *  id        : unique string key
     *  icon      : emoji displayed in the slot
     *  label     : short name shown under icon
     *  key       : keyboard label shown top-right
     *  keyCode   : JS keyCode that triggers this slot
     *  cooldownMs: milliseconds before the slot can be used again (client-side UI only)
     *  onUse     : function called when the slot is activated
     * ─────────────────────────────────────────────────────────────────────── */
    var INVENTORY_SLOTS = [
        {
            id:         'growth',
            icon:       '🌱',
            label:      'Growth',
            key:        '3',
            keyCode:    51,
            cooldownMs: 5000,
            onUse: function () {
                // sendUint8(28) will be live once server-side is wired;
                // for now the slot activates visually and the packet fires
                // as soon as the server handler for opcode 28 exists.
                if (typeof sendMouseMove === 'function') sendMouseMove();
                if (typeof sendUint8    === 'function') sendUint8(28);
            }
        }
        /* ← future powerups go here */
    ];

    /* ── Internal state ─────────────────────────────────────────────────── */
    var slotCooldownUntil = {};   // id → timestamp when cooldown ends
    var dragSlotId        = null; // id of slot currently being dragged
    var inventoryVisible  = false;

    /* ── DOM refs (populated in init) ──────────────────────────────────────*/
    var invEl    = null;
    var ghostEl  = null;

    /* ── Build the DOM once ─────────────────────────────────────────────── */
    function buildSlots() {
        invEl.innerHTML = '';
        INVENTORY_SLOTS.forEach(function (slot) {
            slotCooldownUntil[slot.id] = 0;

            var div = document.createElement('div');
            div.className   = 'inv-slot';
            div.id          = 'inv-slot-' + slot.id;
            div.draggable   = true;
            div.title       = slot.label + ' (press ' + slot.key + ' or drag to map)';
            div.innerHTML   =
                '<span class="slot-key">'   + slot.key   + '</span>' +
                '<span class="slot-icon">'  + slot.icon  + '</span>' +
                '<span class="slot-label">' + slot.label + '</span>' +
                '<canvas class="slot-cd" width="64" height="64"></canvas>';

            /* drag start */
            div.addEventListener('dragstart', function (e) {
                if (isOnCooldown(slot.id)) { e.preventDefault(); return; }
                dragSlotId = slot.id;
                ghostEl.innerHTML  = slot.icon;
                ghostEl.style.display = 'flex';
                /* use a transparent 1x1 image so the default ghost is hidden */
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
            if (slot && !isOnCooldown(slot.id)) {
                activateSlot(slot);
            }
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
        if (!inventoryVisible) return;
        /* skip if player is typing in chat */
        var active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

        INVENTORY_SLOTS.forEach(function (slot) {
            if (e.keyCode === slot.keyCode && !isOnCooldown(slot.id)) {
                activateSlot(slot);
            }
        });
    }

    /* ── Activate a slot ────────────────────────────────────────────────── */
    function activateSlot(slot) {
        slot.onUse();
        startCooldown(slot);
        flashSlot(slot.id);
    }

    /* ── Cooldown helpers ───────────────────────────────────────────────── */
    function isOnCooldown(id) {
        return Date.now() < (slotCooldownUntil[id] || 0);
    }

    function startCooldown(slot) {
        slotCooldownUntil[slot.id] = Date.now() + slot.cooldownMs;
        var el = document.getElementById('inv-slot-' + slot.id);
        if (el) el.classList.add('on-cooldown');
        setTimeout(function () {
            var el2 = document.getElementById('inv-slot-' + slot.id);
            if (el2) el2.classList.remove('on-cooldown');
        }, slot.cooldownMs);
    }

    /* ── Visual flash on activation ─────────────────────────────────────── */
    function flashSlot(id) {
        var el = document.getElementById('inv-slot-' + id);
        if (!el) return;
        el.classList.remove('active');
        /* force reflow so the animation re-triggers */
        void el.offsetWidth;
        el.classList.add('active');
        setTimeout(function () { el.classList.remove('active'); }, 400);
    }

    /* ── Cooldown ring drawn on the slot's canvas each frame ────────────── */
    function drawCooldownRings() {
        INVENTORY_SLOTS.forEach(function (slot) {
            var slotEl = document.getElementById('inv-slot-' + slot.id);
            if (!slotEl) return;
            var cv = slotEl.querySelector('.slot-cd');
            if (!cv) return;
            var ctx2 = cv.getContext('2d');
            ctx2.clearRect(0, 0, 64, 64);

            var until = slotCooldownUntil[slot.id] || 0;
            var now   = Date.now();
            if (now >= until) return; /* no ring needed */

            var progress = 1 - (until - now) / slot.cooldownMs; /* 0→1 */
            var cx = 32, cy = 32, r = 28;
            ctx2.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx2.lineWidth   = 4;
            ctx2.beginPath();
            ctx2.arc(cx, cy, r, 0, Math.PI * 2);
            ctx2.stroke();

            ctx2.strokeStyle = 'rgba(78,255,145,0.85)';
            ctx2.lineWidth   = 4;
            ctx2.lineCap     = 'round';
            ctx2.beginPath();
            ctx2.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
            ctx2.stroke();
        });
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

    /* Called once per animation frame from main_out.js drawGameScene() */
    window.inventoryTick = function () {
        if (inventoryVisible) drawCooldownRings();
    };

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
