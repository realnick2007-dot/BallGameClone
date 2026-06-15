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
 * Using type 1 (food) caused the pellet to enter the normal food eat path in
 * resolveCollision, which requires the eater to be 1.15x the pellet's size AND
 * only calls onEat on the eater — onEaten on the pellet was NEVER reached.
 * With type 5 we add a dedicated branch in resolveCollision that always lets a
 * PlayerCell eat it and correctly calls pellet.onEaten(eaterCell).
 *
 * Rendered as a bright cyan dot — vanilla clients show any type as a coloured
 * circle so no client-side changes are needed.
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
        this._spawnTick = server ? server.ticks : 0;
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
