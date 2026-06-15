var Cell = require('./Cell');

/**
 * GrowthPellet  —  a physical powerup entity spawned by a player pressing key 3.
 *
 * Behaviour:
 *   - Sits on the map like food / a virus (visible to all clients).
 *   - When a player cell overlaps it and is large enough to eat it,
 *     the eating cell receives a one-time mass boost.
 *   - Disappears after being eaten OR after growthPelletLifeTime seconds
 *     (if configured).  No respawn — it is spawned on-demand.
 *   - Rendered as a bright lime-green circle (type 1 = food, distinct colour)
 *     so vanilla clients show it without any client-side changes.
 *
 * Eat flow (called by Server.resolveCollision):
 *   check.onEat(cell)   — check=eater (PlayerCell), cell=pellet (this).
 *                         The base Cell.onEat grows the eater by sqrt(eaterR + pelletR).
 *                         We must NOT double-count that gain in onEaten.
 *   cell.onEaten(check) — called on the pellet (this) after onEat.
 *                         We apply the mass boost on top of the eater's
 *                         already-updated size from onEat.
 */
class GrowthPellet extends Cell {
    constructor(server, owner, position, size) {
        super(server, null, position, size || server.config.growthPelletSize);
        // type 1 = food — understood by all vanilla clients, renders as a dot.
        this.type = 1;
        this.isGrowthPellet = true;
        this.spawner = owner;
        this.color = {
            r: 0x00,
            g: 0xff,
            b: 0x88
        };
        this._spawnTick = server ? server.ticks : 0;
    }

    // ── Eat rules ────────────────────────────────────────────────────────────

    /** Pellets never eat other cells. */
    canEat(cell) {
        return false;
    }

    /**
     * Called on the pellet (this) by resolveCollision after the eater's onEat.
     * `eater` is the PlayerCell that consumed us.
     *
     * BUG 3 FIX: base Cell.onEat already called setSize(sqrt(eaterRadius + pelletRadius))
     * on the eater, so eater._size already includes the normal eat gain.
     * We apply the mass boost on top of that current size — do NOT re-read a
     * pre-eat snapshot, just add extra size on top of whatever onEat left.
     */
    onEaten(eater) {
        var boost = this.server.config.growthPelletMassBoost || 500;
        // Convert mass boost to size: size = sqrt(mass * 100)
        var extraSize = Math.sqrt(boost * 100);
        var cap = this.server.config.playerMaxSize || 3162;
        // eater._size is already the post-onEat size; add the bonus on top cleanly.
        eater.setSize(Math.min(eater._size + extraSize, cap));
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    onAdd(server) {
        server.nodesGrowthPellets = server.nodesGrowthPellets || [];
        server.nodesGrowthPellets.push(this);
        var lifeMs = (server.config.growthPelletLifeTime || 0) * 1000;
        if (lifeMs > 0) {
            var self = this;
            setTimeout(function () {
                if (!self.isRemoved) server.removeNode(self);
            }, lifeMs);
        }
    }

    onRemove(server) {
        var arr = server.nodesGrowthPellets;
        if (!arr) return;
        var idx = arr.indexOf(this);
        if (idx !== -1) arr.splice(idx, 1);
    }
}

module.exports = GrowthPellet;
