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
 * Fix 2 (NaN expiry): mainLoop reads pellet.createdAt for lifetime checks.
 *   The old constructor set this._spawnTick instead of this.createdAt, so
 *   pellet.createdAt was always undefined, making the comparison NaN — every
 *   pellet was flagged for removal on every single tick, compounding the crash.
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
        // Fix 2: was this._spawnTick — mainLoop expiry reads this.createdAt
        this.createdAt = server ? server.ticks : 0;
    }

    // Pellets never eat other cells.
    canEat(cell) {
        return false;
    }

    /**
     * Called by resolveCollision (our dedicated branch) when a PlayerCell eats
     * this pellet. Adds a flat mass bonus (growthPelletMassBoost) regardless of
     * the eater's current size — mass = size² × 0.01, so we convert both ways.
     */
    onEaten(eater) {
        var boost = this.server.config.growthPelletMassBoost || 500;
        var currentMass = eater._size * eater._size * 0.01;
        var newMass = currentMass + boost;
        var newSize = Math.sqrt(newMass * 100);
        var cap = this.server.config.playerMaxSize || 3162;
        eater.setSize(Math.min(newSize, cap));
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
