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
 */
class GrowthPellet extends Cell {
    /**
     * @param {object} server
     * @param {object|null} owner  - the PlayerTracker who spawned it (for reference only)
     * @param {Vec2}   position
     * @param {number} size        - radius of the pellet
     */
    constructor(server, owner, position, size) {
        super(server, null, position, size || server.config.growthPelletSize);
        // type 1 = food — understood by all vanilla clients, renders as a dot.
        // We give it a distinct bright colour so players can spot it.
        this.type = 1;
        this.isGrowthPellet = true;
        this.spawner = owner; // the player who pressed key 3
        this.color = {
            r: 0x00,
            g: 0xff,
            b: 0x88
        };
        // optional auto-expire
        this._spawnTick = server ? server.ticks : 0;
    }

    // ── Eat rules ────────────────────────────────────────────────────────────

    /**
     * Any player cell can eat this pellet (same rule as food).
     * The eating cell must be larger — the default Cell.canEat logic handles that,
     * but food uses type==1 with no canEat override, so we replicate that here.
     */
    canEat(cell) {
        return false; // pellets don't eat other cells
    }

    /**
     * Called when a player cell eats this pellet.
     * Grants the configured mass boost directly.
     */
    onEaten(cell) {
        var boost = this.server.config.growthPelletMassBoost || 500;
        // Convert mass boost to size boost: size = sqrt(mass * 100)
        var extraSize = Math.sqrt(boost * 100);
        var cap = this.server.config.playerMaxSize || 3162;
        cell.setSize(Math.min(cell._size + extraSize, cap));
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    onAdd(server) {
        server.nodesGrowthPellets = server.nodesGrowthPellets || [];
        server.nodesGrowthPellets.push(this);
        // schedule auto-remove if lifetime is configured
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
GrowthPellet.prototype = new (require('./Cell'))();
