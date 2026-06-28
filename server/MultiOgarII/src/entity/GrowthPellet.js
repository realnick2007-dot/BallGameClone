var Cell = require('./Cell');

/**
 * GrowthPellet  —  a physical powerup entity spawned by a player pressing key 3.
 *
 * Type 5 = GrowthPellet (new dedicated type).
 *   - type 0 = PlayerCell
 *   - type 1 = Food
 *   - type 2 = Virus
 *   - type 3 = EjectedMass
 *   - type 4 = MotherCell
 *   - type 5 = GrowthPellet  <-- us
 *
 * Fix 1 (double-push crash): onAdd() pushes 'this' into nodesGrowthPellets.
 *   spawnGrowthPellet() in Server.js was ALSO pushing it after addNode().
 *   That caused every pellet to appear twice in the array. The mainLoop expiry
 *   block would removeNode() the first reference (setting isRemoved=true and
 *   quadItem=null), then hit the duplicate and call removeNode() again on a node
 *   with quadItem=null — quadTree.remove(null) threw an unhandled exception that
 *   killed the WebSocket process with error 1006.
 *
 * Fix 2 (redundant createdAt): Cell base constructor already sets
 *   this.createdAt = server.ticks inside super(). The child constructor
 *   was re-assigning it immediately after, creating an ordering dependency
 *   that could diverge if the base class changes. Removed.
 *
 * Fix 3 (NaN size / stacked pellet crash): when multiple pellets are stacked on
 *   top of each other and eaten in the same tick, onEaten() fires multiple times
 *   on the same eater cell within one eatCollisions pass. Each call boosts mass
 *   and calls setSize(). If the accumulated size reaches or exceeds playerMaxSize,
 *   autoSplit() fires on the same cell during the nodesPlayer.forEach pass and
 *   computes size1 = sqrt(parent.radius - splitSize^2). When the parent was
 *   capped at exactly playerMaxSize and split mass exceeds parent radius due to
 *   floating-point rounding, size1 = sqrt(negative) = NaN. A NaN size
 *   propagates into quadTree bounds, corrupting the tree and causing
 *   quadTree.remove/insert to throw — killing the WebSocket process (1006).
 *
 *   Fix: cap newMass in onEaten so the resulting size stays strictly BELOW
 *   playerMaxSize (leaving room for autoSplit to do clean math), and skip the
 *   boost entirely if the eater is already at or above the cap.
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
        // Do NOT re-assign it here — Cell already does: this.createdAt = server.ticks
    }

    // Pellets never eat other cells.
    canEat(cell) {
        return false;
    }

    /**
     * Called by resolveCollision (our dedicated branch) when a PlayerCell eats
     * this pellet. Adds a flat mass bonus (growthPelletMassBoost) to the eater.
     *
     * FIX 3: cap newMass so the resulting size stays strictly below playerMaxSize.
     * This prevents autoSplit from receiving a NaN size when multiple stacked
     * pellets are eaten in the same tick and the eater is boosted past the cap.
     */
    onEaten(eater) {
        var boost = this.server.config.growthPelletMassBoost || 500;
        var cap = this.server.config.playerMaxSize || 3162;

        // Convert current size to mass, apply boost, convert back to size.
        var currentMass = eater._size * eater._size * 0.01;
        var newMass = currentMass + boost;
        var newSize = Math.sqrt(newMass * 100);

        // Clamp to strictly less than playerMaxSize so autoSplit always has
        // clean positive radicand: size1 = sqrt(parent.radius - splitSize^2).
        // Using (cap - 1) gives a 1-unit gap that is invisible in gameplay but
        // prevents the floating-point underflow that produces NaN.
        var hardCap = cap - 1;
        if (newSize > hardCap) newSize = hardCap;

        // Skip the setSize call entirely if the eater is already at or above
        // the hard cap — no point clamping to a value they already exceed.
        if (eater._size >= hardCap) return;

        eater.setSize(newSize);
    }

    // Fix 1: onAdd() is the ONLY place this pellet is pushed into nodesGrowthPellets.
    // spawnGrowthPellet() in Server.js must NOT push again after calling addNode().
    onAdd(server) {
        server.nodesGrowthPellets = server.nodesGrowthPellets || [];
        server.nodesGrowthPellets.push(this);
        // setTimeout-based lifetime is handled by mainLoop via createdAt — no
        // separate timer needed. Keeping this clean avoids double-remove races.
    }

    onRemove(server) {
        var arr = server.nodesGrowthPellets;
        if (!arr) return;
        var idx = arr.indexOf(this);
        if (idx !== -1) arr.splice(idx, 1);
    }
}

module.exports = GrowthPellet;
