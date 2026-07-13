var Cell = require('./Cell');

/**
 * FreezePowerup — a physical powerup entity dropped by a player pressing Y.
 *
 * Type 8 = FreezePowerup (dedicated type).
 *   - type 7 = Portal
 *   - type 8 = FreezePowerup  <-- us
 *
 * When any PlayerCell eats it, the eater's owner is frozen for
 * config.freezePowerupDuration seconds via freezePowerupTicks. That timer is
 * DISTINCT from the cellsFrozen ability toggle (F key) so the portal force-kick
 * logic can tell the freeze POWERUP apart from the freeze ABILITY.
 *
 * Follows GrowthPellet discipline: onAdd() is the SOLE push into
 * nodesFreezePowerups; createdAt is set by the Cell base constructor.
 */
class FreezePowerup extends Cell {
    constructor(server, owner, position, size) {
        super(server, null, position, size || server.config.freezePowerupSize);
        this.type = 8;
        this.isFreezePowerup = true;
        this.spawner = owner;
        this.color = {
            r: 0x66,
            g: 0xE0,
            b: 0xFF   // icy cyan
        };
    }

    canEat(cell) {
        return false;
    }

    onEaten(eater) {
        if (!eater || !eater.owner) return;
        var dur = this.server.config.freezePowerupDuration || 4;
        eater.owner.freezePowerupTicks = dur * 25;
    }

    onAdd(server) {
        server.nodesFreezePowerups = server.nodesFreezePowerups || [];
        server.nodesFreezePowerups.push(this);
    }

    onRemove(server) {
        var arr = server.nodesFreezePowerups;
        if (!arr) return;
        var idx = arr.indexOf(this);
        if (idx !== -1) arr.splice(idx, 1);
    }
}

module.exports = FreezePowerup;
