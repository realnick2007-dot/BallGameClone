var Cell = require('./Cell');

/**
 * Coin  —  a collectible currency entity that spawns randomly on the map.
 *
 * Type 6 = Coin (dedicated type).
 *   - type 0 = PlayerCell
 *   - type 1 = Food
 *   - type 2 = Virus
 *   - type 3 = EjectedMass
 *   - type 4 = MotherCell
 *   - type 5 = GrowthPellet
 *   - type 6 = Coin  <-- us
 *
 * Behaviour:
 *   - Rendered as a round circle blob on the client (isCoin flag signals
 *     the client renderer to overlay a coin image on top).
 *   - Any PlayerCell that overlaps a Coin consumes it.
 *   - On pickup, the owning player's `currency` counter is incremented
 *     by server.config.coinCurrencyValue.
 *   - After removal, spawnCoin() is called automatically to maintain
 *     server.config.coinAmount live coins at all times.
 *
 * Fix notes (matches GrowthPellet discipline):
 *   - onAdd() is the SOLE place this coin is pushed into server.nodesCoins.
 *     spawnCoin() in Server.js must NOT push again after addNode().
 *   - this.createdAt is set by the Cell base constructor — do NOT re-assign.
 */
class Coin extends Cell {
    constructor(server, owner, position, size) {
        super(server, null, position, size || server.config.coinSize);
        this.type = 6;
        this.isCoin = true;  // client renderer looks for this flag
        this.color = {
            r: 0xFF,
            g: 0xD7,
            b: 0x00   // gold yellow
        };
    }

    // Coins never eat other cells.
    canEat(cell) {
        return false;
    }

    /**
     * Called by resolveCollision (type-6 branch in Server.js) when a
     * PlayerCell overlaps this coin. Awards currency to the eating player.
     *
     * Called AFTER removeNode(coin) so isRemoved is true before any further
     * collision pass can touch the same node (mirrors GrowthPellet pattern).
     */
    onEaten(eater) {
        if (!eater || !eater.owner) return;
        var value = this.server.config.coinCurrencyValue || 10;
        // Initialise currency if this is the player's first pickup
        if (eater.owner.currency === undefined) eater.owner.currency = 0;
        eater.owner.currency += value;
    }

    // Fix: onAdd() is the ONLY place coins are pushed into nodesCoins.
    onAdd(server) {
        server.nodesCoins = server.nodesCoins || [];
        server.nodesCoins.push(this);
    }

    onRemove(server) {
        var arr = server.nodesCoins;
        if (!arr) return;
        var idx = arr.indexOf(this);
        if (idx !== -1) arr.splice(idx, 1);
        // Maintain target coin count on the map
        server.spawnCoin();
    }
}

module.exports = Coin;
