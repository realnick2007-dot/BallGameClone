var Cell = require('./Cell');
var EjectedMass = require('./EjectedMass');

/**
 * Portal — a physical powerup entity dropped by a player pressing U.
 *
 * Type 7 = Portal (dedicated type).
 *   - type 6 = Coin
 *   - type 7 = Portal  <-- us
 *
 * Behaviour (all approved in the plan):
 *   - A player cell that overlaps the portal is registered as an occupant
 *     (Server.enterPortal). While occupied, every owned cell is sucked toward
 *     the portal centre and shrunk; the removed mass is stashed in
 *     portalState.hiddenMass and restored on exit. Mass is conserved.
 *   - Normal exit: once all of an occupant's cells reach the centre AND shrink
 *     to the portalMinScale floor, the cluster is teleported to a random safe
 *     map point and its mass restored.
 *   - Force-kick: after portalForceKickDelay seconds an occupant is ejected
 *     near the portal with mass restored. This bypasses the freeze ABILITY
 *     (cellsFrozen) but is DEFERRED while the freeze POWERUP (freezePowerupTicks)
 *     is active.
 *   - Self-destruct: after portalLifetime seconds the portal removes itself,
 *     restoring every occupant's mass in place and spitting purple mass.
 *   - Feeding: the portal eats normal ejected mass (type 3) via the generic
 *     resolveCollision path. Every portalFeedRequired eaten, it spits
 *     portalBurstCount purple portal-mass and resets to its base size. On the
 *     portalBurstCyclesToDestroy-th cycle it spits portalDestroyBurstCount mass
 *     and destroys itself. Its own purple mass is tagged isPortalMass so the
 *     portal never re-eats it (prevents a runaway feedback loop).
 *
 * Follows GrowthPellet/Coin discipline: onAdd() is the SOLE push into
 * nodesPortals; createdAt is set by the Cell base constructor.
 */
class Portal extends Cell {
    constructor(server, owner, position, size) {
        super(server, null, position, size || server.config.portalSize);
        this.type = 7;
        this.isPortal = true;
        this.spawner = owner;
        this.color = {
            r: 0x8A,
            g: 0x2B,
            b: 0xE2   // purple
        };
        this.feedProgress = 0;
        this.burstCycles = 0;
        this.birthTick = this.createdAt;
        this.baseSize = this._size;
    }

    // Feeds only on player-ejected mass, never on its own purple burst mass.
    canEat(cell) {
        if (this.burstCycles >= this.server.config.portalBurstCyclesToDestroy) return false;
        return cell.type == 3 && !cell.isPortalMass;
    }

    // Generic resolveCollision path: portal grows by eating ejected mass.
    onEat(prey) {
        this.setSize(Math.sqrt(this.radius + prey.radius));
        this.feedProgress++;
        var config = this.server.config;
        if (this.feedProgress < config.portalFeedRequired) return;
        this.feedProgress = 0;
        this.burstCycles++;
        if (this.burstCycles >= config.portalBurstCyclesToDestroy) {
            this.burstMass(config.portalDestroyBurstCount);
            this.server.removeNode(this); // onRemove restores any occupants
            return;
        }
        this.burstMass(config.portalBurstCount);
        this.setSize(this.baseSize);
    }

    burstMass(count) {
        var server = this.server, config = server.config;
        var size = config.portalMassSizeMultiplier || (config.ejectSize + 5);
        for (var i = 0; i < count; i++) {
            var angle = 2 * Math.PI * Math.random();
            var mass = new EjectedMass(server, null, this.position.clone(), size);
            mass.isPortalMass = true;
            mass.color = { r: 0x8A, g: 0x2B, b: 0xE2 };
            mass.setBoost(config.ejectVelocity, angle);
            server.addNode(mass);
        }
    }

    // Restore proportionally across an occupant's current cells (handles
    // splits/merges that happened while inside), capped below playerMaxSize.
    restoreMass(owner) {
        var ps = owner.portalState;
        var hidden = ps ? ps.hiddenMass : 0;
        if (hidden > 0 && owner.cells.length) {
            var total = 0;
            for (var i = 0; i < owner.cells.length; i++)
                total += owner.cells[i]._size * owner.cells[i]._size * 0.01;
            var cap = (this.server.config.playerMaxSize || 3162) - 1;
            for (var j = 0; j < owner.cells.length; j++) {
                var cell = owner.cells[j];
                var cm = cell._size * cell._size * 0.01;
                var share = total > 0 ? hidden * (cm / total) : hidden / owner.cells.length;
                var newSize = Math.sqrt((cm + share) * 100);
                if (newSize > cap) newSize = cap;
                cell.setSize(newSize);
                this.server.updateNodeQuad(cell);
            }
        }
        if (ps) ps.hiddenMass = 0;
    }

    releaseOwner(owner) {
        owner.portalActive = false;
        var ps = owner.portalState;
        if (ps) {
            ps.portal = null;
            ps.phase = null;
            ps.hiddenMass = 0;
        }
    }

    // Normal exit: teleport the cluster to a random safe point, restore mass.
    teleportOwner(owner) {
        this.restoreMass(owner);
        var pos = this.server.randomPos();
        for (var i = 0; i < owner.cells.length; i++) {
            var cell = owner.cells[i];
            cell.position.x = pos.x + (Math.random() - 0.5) * cell._size;
            cell.position.y = pos.y + (Math.random() - 0.5) * cell._size;
            this.server.updateNodeQuad(cell);
        }
        this.releaseOwner(owner);
    }

    // Force-kick / spit an occupant out just past the portal edge, mass restored.
    kickOwner(owner) {
        this.restoreMass(owner);
        for (var i = 0; i < owner.cells.length; i++) {
            var cell = owner.cells[i];
            var angle = 2 * Math.PI * Math.random();
            var r = this._size * 1.5 + cell._size;
            cell.position.x = this.position.x + Math.cos(angle) * r;
            cell.position.y = this.position.y + Math.sin(angle) * r;
            cell.checkBorder(this.server.border);
            this.server.updateNodeQuad(cell);
        }
        this.releaseOwner(owner);
    }

    // Per-tick driver, called from Server.mainLoop over a nodesPortals snapshot.
    update(server) {
        var config = server.config;
        var now = server.ticks;
        // Self-destruct by lifetime — removeNode() -> onRemove() restores occupants.
        if (now - this.birthTick >= config.portalLifetime * 25) {
            this.burstMass(config.portalDestroyBurstCount);
            server.removeNode(this);
            return;
        }
        for (var i = 0; i < server.clients.length; i++) {
            var owner = server.clients[i];
            if (!owner.portalState || owner.portalState.portal !== this) continue;
            if (!owner.cells || owner.cells.length === 0) { this.releaseOwner(owner); continue; }
            var ps = owner.portalState;
            // Force-kick after portalForceKickDelay seconds. Bypasses the freeze
            // ABILITY, but the freeze POWERUP defers it.
            if (now - ps.enterTick >= config.portalForceKickDelay * 25) {
                if (owner.freezePowerupTicks > 0) continue; // freeze powerup defers
                this.kickOwner(owner);
                continue;
            }
            // Freeze (ability OR powerup) suppresses suction + shrink.
            if (owner.cellsFrozen || owner.freezePowerupTicks > 0) continue;
            var floor = Math.max(server.config.playerMinSize, this.baseSize * config.portalMinScale);
            var allInside = true;
            for (var c = 0; c < owner.cells.length; c++) {
                var cell = owner.cells[c];
                var dx = this.position.x - cell.position.x;
                var dy = this.position.y - cell.position.y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 1) {
                    var step = Math.min(config.portalSuctionSpeed, dist);
                    cell.position.x += dx / dist * step;
                    cell.position.y += dy / dist * step;
                    dist -= step;
                }
                if (cell._size > floor) {
                    var oldMass = cell._size * cell._size * 0.01;
                    var newSize = cell._size * (1 - config.portalShrinkRate);
                    if (newSize < floor) newSize = floor;
                    ps.hiddenMass += oldMass - newSize * newSize * 0.01;
                    cell.setSize(newSize);
                }
                server.updateNodeQuad(cell);
                if (dist > this._size * 0.3 || cell._size > floor + 0.5) allInside = false;
            }
            ps.phase = allInside ? 'inside' : 'sucking';
            if (allInside) this.teleportOwner(owner);
        }
    }

    onAdd(server) {
        server.nodesPortals = server.nodesPortals || [];
        server.nodesPortals.push(this);
    }

    onRemove(server) {
        var arr = server.nodesPortals;
        if (arr) {
            var idx = arr.indexOf(this);
            if (idx !== -1) arr.splice(idx, 1);
        }
        // Safety net: restore + release any occupant still attached to this portal
        // (covers feed-destroy and self-destruct paths). Cells stay where they are.
        for (var i = 0; i < server.clients.length; i++) {
            var owner = server.clients[i];
            if (owner.portalState && owner.portalState.portal === this) {
                this.restoreMass(owner);
                this.releaseOwner(owner);
            }
        }
    }
}

module.exports = Portal;
