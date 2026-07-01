var Cell = require('./Cell');

/**
 * GrowthPellet  —  a physical powerup entity spawned by a player pressing key 3.
 *
 * Type 5 = GrowthPellet (dedicated type).
 *   - type 0 = PlayerCell
 *   - type 1 = Food
 *   - type 2 = Virus
 *   - type 3 = EjectedMass
 *   - type 4 = MotherCell
 *   - type 5 = GrowthPellet  <-- us
 *
 * Fix 1 (double-push crash): onAdd() is the SOLE place this pellet is pushed
 *   into nodesGrowthPellets. spawnGrowthPellet() in Server.js must NOT push
 *   again after addNode(). Double-registration caused removeNode() to fire twice
 *   on the same node — second call hit quadItem=null and threw, killing the
 *   WebSocket process with error 1006.
 *
 * Fix 2 (redundant createdAt): Cell base constructor sets this.createdAt inside
 *   super(). The child must NOT re-assign it — removed.
 *
 * Fix 3 (NaN size / stacked-pellet crash): when multiple stacked pellets are
 *   eaten in the same tick, onEaten() fires several times on the same eater.
 *   Each call boosts mass and calls setSize(). If accumulated size reaches or
 *   exceeds playerMaxSize, autoSplit() computes size1 = sqrt(parent.radius -
 *   splitSize^2). Floating-point overshoot makes that negative → NaN → quadTree
 *   corruption → 1006 crash.
 *   Fix: cap newSize to (playerMaxSize - 1) and skip entirely if already at cap.
 */
class GrowthPellet extends Cell {
    constructor(server, owner, position, size) {
        super(server, null, position, size || server.config.growthPelletSize);
        this.type = 5;            // dedicated growth-pellet type
        this.isGrowthPellet = true;
        this.spawner = owner;
        this.color = {
            r: 0x00,
            g: 0xff,
            b: 0x88
        };
        // NOTE: this.createdAt is set by Cell base constructor via super().
        // Do NOT re-assign it here.
    }

    // Pellets never eat other cells.
    canEat(cell) {
        return false;
    }

    /**
     * Called by resolveCollision (dedicated type-5 branch in Server.js) when a
     * PlayerCell overlaps this pellet. Adds a flat mass bonus (growthPelletMassBoost)
     * to the eater.
     *
     * IMPORTANT: call this AFTER removeNode(pellet) so isRemoved=true before any
     * recursive collision pass can touch the same node.
     *
     * Fix 3: cap newSize strictly below playerMaxSize so autoSplit always has a
     * clean positive radicand. A 1-unit gap is invisible in gameplay but prevents
     * the floating-point underflow that produces NaN.
     */
    onEaten(eater) {
        var boost   = this.server.config.growthPelletMassBoost || 500;
        var cap     = this.server.config.playerMaxSize || 3162;
        var hardCap = cap - 1;  // 1-unit gap keeps autoSplit math clean

        // Skip entirely if already at or above the hard cap.
        if (eater._size >= hardCap) return;

        var currentMass = eater._size * eater._size * 0.01;
        var newMass     = currentMass + boost;
        var newSize     = Math.sqrt(newMass * 100);

        if (newSize > hardCap) newSize = hardCap;
        eater.setSize(newSize);
    }

    /**
     * Fix 1: onAdd() is the ONLY place this pellet is pushed into nodesGrowthPellets.
     * spawnGrowthPellet() in Server.js must NOT push again after calling addNode().
     * Lifetime expiry is handled by mainLoop via createdAt — no separate timer needed.
     */
    onAdd(server) {
        server.nodesGrowthPellets = server.nodesGrowthPellets || [];
        server.nodesGrowthPellets.push(this);
    }

    onRemove(server) {
        var arr = server.nodesGrowthPellets;
        if (!arr) return;
        var idx = arr.indexOf(this);
        if (idx !== -1) arr.splice(idx, 1);
    }
}

module.exports = GrowthPellet;
