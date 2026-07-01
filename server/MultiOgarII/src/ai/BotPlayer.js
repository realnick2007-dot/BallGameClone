const PlayerTracker = require('../PlayerTracker');
const Vec2 = require('../modules/Vec2');

/**
 * decideTypes — indexed by node.type:
 *   0 = PlayerCell
 *   1 = Food
 *   2 = Virus
 *   3 = EjectedMass
 *   4 = MotherCell
 *   5 = GrowthPellet
 *
 * FIX: previously only types 0–3 were defined. When a bot's viewNodes
 * contained a GrowthPellet (type 5) or MotherCell (type 4), the lookup
 * returned undefined and .call() threw:
 *   TypeError: Cannot read properties of undefined (reading 'call')
 * crashing the entire server process.
 *
 * Added type 4 (MotherCell) — treated like a large virus: avoid if it
 * would split the bot, neutral otherwise.
 * Added type 5 (GrowthPellet) — always chase it, same as food.
 */
const decideTypes = [
    // 0 — PlayerCell
    function decidePlayer(node, cell) {
        // Same team, don't eat
        if (this.server.mode.haveTeams && cell.owner.team == node.owner.team)
            return 0;
        if (cell._size > node._size * 1.15) // Edible
            return node._size * 2.5;
        if (node._size > cell._size * 1.15) // Bigger, avoid
            return -node._size;
        return -(node._size / cell._size) / 3;
    },
    // 1 — Food
    function decideFood(node, cell) {
        return 1; // Always edible
    },
    // 2 — Virus
    function decideVirus(node, cell) {
        if (cell._size > node._size * 1.15) { // Edible
            if (this.cells.length == this.server.config.playerMaxCells) {
                // Reached cell limit, won't explode
                return node._size * 2.5;
            }
            // Will explode, avoid
            return -1;
        }
        if (node.isMotherCell && node._size > cell._size * 1.15)
            return -1; // Avoid mother cell if bigger than player
        return 0;
    },
    // 3 — EjectedMass
    function decideEjected(node, cell) {
        if (cell._size > node._size * 1.15)
            return node._size;
        return 0;
    },
    // 4 — MotherCell
    // Treat like a virus: avoid if the bot would get split by eating it,
    // otherwise neutral (bot is too small to eat it anyway).
    function decideMotherCell(node, cell) {
        if (cell._size > node._size * 1.15) {
            if (this.cells.length == this.server.config.playerMaxCells)
                return node._size * 2.5; // Can eat without exploding
            return -1; // Would explode, avoid
        }
        return 0;
    },
    // 5 — GrowthPellet
    // Always chase it — free mass boost for the bot, same logic as food.
    function decideGrowthPellet(node, cell) {
        return node._size; // weighted by pellet size so bigger pellets attract more
    },
];

class BotPlayer extends PlayerTracker {
    constructor(server, socket) {
        super(server, socket);
        this.isBot = true;
        this.influence = 0;
    }
    largest(list) {
        return list.reduce((largest, current) => {
            return current._size > largest._size ? current : largest;
        });
    }
    checkConnection() {
        // Respawn if bot is dead
        if (!this.cells.length)
            this.server.mode.onPlayerSpawn(this.server, this);
    }
    sendUpdate() {
        this.decide(this.largest(this.cells));
    }
    decide(cell) {
        if (!cell)
            return;

        const result = new Vec2(0, 0);

        for (const node of this.viewNodes) {
            if (node.owner == this)
                continue;

            // Guard: skip any node type that has no decision handler.
            // Without this, a new entity type (e.g. GrowthPellet = type 5)
            // returns undefined from the array and .call() throws, crashing
            // the entire server process.
            if (!decideTypes[node.type])
                continue;

            // Make decisions
            this.influence = decideTypes[node.type].call(this, node, cell);

            // Conclude decisions
            // Apply this.influence if it isn't 0
            if (this.influence == 0)
                continue;

            // Calculate separation between cell and node
            const displacement = node.position.difference(cell.position);

            // Figure out distance between cells
            let distance = displacement.dist();

            if (this.influence < 0) // Get edge distance
                distance -= cell._size + node._size;

            // The farther they are the smaller influence it is
            if (distance < 1)
                distance = 1;

            this.influence /= distance;

            // Splitting conditions
            if (node.type != 1 && cell._size > node._size * 1.15 &&
                !this.splitCooldown && this.cells.length < 8 &&
                400 - cell._size / 2 - node._size >= distance) {
                // Splitkill the target
                this.splitCooldown = 15;
                this.mouse.assign(node.position);
                this.socket.packetHandler.pressSpace = true;
                return;
            } else {
                // Produce force vector exerted by this entity on the cell
                result.add(displacement.normalize().product(this.influence));
            }
        }

        // Set bot's mouse position
        this.mouse.assign(cell.position.sum(result.multiply(900)));
    }
}
module.exports = BotPlayer;
