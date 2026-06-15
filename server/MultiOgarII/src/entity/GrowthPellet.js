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
 *   1. check.onEat(cell)  — the standard Cell.onEat grows the eater by the
 *      combined-radius formula.  We override this on GrowthPellet so we can
 *      capture the eater's pre-eat size BEFORE the standard formula fires,
 *      then apply the full mass boost on top.
 *   2. cell.onEaten(check) — called on the pellet (this).  Applies the boost
 *      using the pre-captured size so the result is deterministic regardless
 *      of what onEat did.
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
        // Will be set by onEat() so onEaten() can use the pre-eat size.
        this._eaterSizeBeforeEat = 0;
    }

    // ── Eat rules ────────────────────────────────────────────────────────────

    /** Pellets never eat other cells. */
    canEat(cell) {
        return false;
    }

    /**
     * Override onEat so we can capture the eater's size BEFORE the standard
     * combined-radius growth formula runs.  We still call super so the node is
     * properly consumed (radius bookkeeping), but the real size change happens
     * inside onEaten() using the pre-captured value.
     *
     * `this` = pellet (prey),  `eater` = the PlayerCell eating us.
     * NOTE: resolveCollision calls  check.onEat(cell)  where check is the
     * larger cell (eater) and cell is the smaller one (pellet = this).
     * So here `this` is the pellet and the argument is the eater.
     */
    onEat(eater) {
        // Capture eater size before ANY modification.
        this._eaterSizeBeforeEat = eater._size;
        // Do NOT call super — we handle sizing entirely in onEaten.
        // (Calling super would do setSize(sqrt(eaterRadius + pelletRadius))
        //  which would then be overwritten by onEaten anyway, so skip it.)
    }

    /**
     * Called on the pellet (this) after the eater's onEat runs.
     * `eater` is the PlayerCell that consumed us.
     * Apply the full mass boost starting from the pre-eat size.
     */
    onEaten(eater) {
        var boost = this.server.config.growthPelletMassBoost || 500;
        // Convert mass boost to size delta: size = sqrt(mass * 100)
        var extraSize = Math.sqrt(boost * 100);
        var cap = this.server.config.playerMaxSize || 3162;
        // Use pre-captured size so result doesn't depend on what onEat did.
        var baseSize = this._eaterSizeBeforeEat || eater._size;
        eater.setSize(Math.min(baseSize + extraSize, cap));
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
