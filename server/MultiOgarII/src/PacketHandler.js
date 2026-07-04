var Packet = require('./packet');
var BinaryReader = require('./packet/BinaryReader');

class PacketHandler {
    constructor(server, socket) {
        this.server = server;
        this.socket = socket;
        this.protocol = 0;
        this.handshakeProtocol = null;
        this.handshakeKey = null;
        this.lastJoinTick = 0;
        this.lastChatTick = 0;
        this.lastStatTick = 0;
        this.lastQTick = 0;
        this.lastSpaceTick = 0;
        this.pressQ = false;
        this.pressW = false;
        this.pressSpace = false;
        // Macro eject: track W held state and last eject tick for throttling
        this.wHeld = false;
        this.lastMacroEjectTick = 0;
        this.mouseData = null;
        this.handler = {
            254: this.handshake_onProtocol.bind(this),
        };
    }
    handleMessage(message) {
        if (!this.handler.hasOwnProperty(message[0]))
            return;
        this.handler[message[0]](message);
        this.socket.lastAliveTime = this.server.stepDateTime;
    }
    handshake_onProtocol(message) {
        if (message.length !== 5)
            return;
        this.handshakeProtocol = message[1] | (message[2] << 8) | (message[3] << 16) | (message[4] << 24);
        if (this.handshakeProtocol < 1 || this.handshakeProtocol > 18) {
            this.socket.close(1002, "Not supported protocol: " + this.handshakeProtocol);
            return;
        }
        this.handler = {
            255: this.handshake_onKey.bind(this),
        };
    }
    handshake_onKey(message) {
        if (message.length !== 5)
            return;
        this.handshakeKey = message[1] | (message[2] << 8) | (message[3] << 16) | (message[4] << 24);
        if (this.handshakeProtocol > 6 && this.handshakeKey !== 0) {
            this.socket.close(1002, "Not supported protocol");
            return;
        }
        this.handshake_onCompleted(this.handshakeProtocol, this.handshakeKey);
    }
    handshake_onCompleted(protocol, key) {
        this.handler = {
            0: this.message_onJoin.bind(this),
            1: this.message_onSpectate.bind(this),
            16: this.message_onMouse.bind(this),
            17: this.message_onKeySpace.bind(this),
            18: this.message_onKeyQ.bind(this),
            21: this.message_onKeyW.bind(this),
            22: this.message_onKeyE.bind(this),
            23: this.message_onKeyR.bind(this),
            24: this.message_onKeyT.bind(this),
            25: this.message_onKeyF.bind(this),  // Freeze/thaw player cells
            26: this.message_onKeyG.bind(this),
            27: this.message_onKeyH.bind(this),
            28: this.message_onKey3.bind(this),  // Growth pellet powerup
            // Opcode 29: W key release — stops macro eject
            29: this.message_onKeyWRelease.bind(this),
            99: this.message_onChat.bind(this),
            254: this.message_onStat.bind(this),
        };
        this.protocol = protocol;
        // Send handshake response
        this.sendPacket(new Packet.ClearAll());
        this.sendPacket(new Packet.SetBorder(this.socket.playerTracker, this.server.border, this.server.config.serverGamemode, "MultiOgarII-Continued " + this.server.version));
        // Send welcome message
        this.server.sendChatMessage(null, this.socket.playerTracker, "MultiOgarII-Continued " + this.server.version);
        if (this.server.config.serverWelcome1)
            this.server.sendChatMessage(null, this.socket.playerTracker, this.server.config.serverWelcome1);
        if (this.server.config.serverWelcome2)
            this.server.sendChatMessage(null, this.socket.playerTracker, this.server.config.serverWelcome2);
        if (this.server.config.serverChat == 0)
            this.server.sendChatMessage(null, this.socket.playerTracker, "This server's chat is disabled.");
        if (this.protocol < 4)
            this.server.sendChatMessage(null, this.socket.playerTracker, "WARNING: Protocol " + this.protocol + " assumed as 4!");
    }
    message_onJoin(message) {
        var tick = this.server.ticks;
        var dt = tick - this.lastJoinTick;
        this.lastJoinTick = tick;
        if (dt < 25 || this.socket.playerTracker.cells.length !== 0) {
            return;
        }
        var reader = new BinaryReader(message);
        reader.skipBytes(1);
        var text = null;
        if (this.protocol < 6)
            text = reader.readStringZeroUnicode();
        else
            text = reader.readStringZeroUtf8();
        this.setNickname(text);
    }
    message_onSpectate(message) {
        if (message.length !== 1 || this.socket.playerTracker.cells.length !== 0) {
            return;
        }
        this.socket.playerTracker.spectate = true;
    }
    message_onMouse(message) {
        if (message.length !== 13 && message.length !== 9 && message.length !== 21) {
            return;
        }
        this.mouseData = Buffer.concat([message]);
    }
    message_onKeySpace(message) {
        if (this.socket.playerTracker.miQ) {
            this.socket.playerTracker.minionSplit = true;
        }
        else {
            this.pressSpace = true;
        }
    }
    message_onKeyQ(message) {
        if (message.length !== 1)
            return;
        var tick = this.server.tickCoutner;
        var dt = tick - this.lastQTick;
        if (dt < this.server.config.ejectCooldown) {
            return;
        }
        this.lastQTick = tick;
        if (!this.server.config.disableQ) {
            this.socket.playerTracker.miQ = !this.socket.playerTracker.miQ;
        }
        else {
            this.pressQ = true;
        }
    }
    message_onKeyH(message) {
        if (!this.server.config.powerupVirus || !this.socket.playerTracker.canUseVirus() || this.socket.playerTracker.spectate) {
            if (this.server.config.powerupVirusEvery) this.socket.playerTracker.lastUsedVirus = this.server.ticks;
            return;
        }
        this.server.spawnVirus(this.socket.playerTracker.mouse, true);
        this.socket.playerTracker.lastUsedVirus = this.server.ticks;
    }
    /**
     * Growth pellet powerup — spawns a GrowthPellet at the player's cursor.
     */
    message_onKey3(message) {
        var client = this.socket.playerTracker;
        if (!this.server.config.powerupGrowth || client.spectate || client.cells.length === 0) return;
        if (!client.canUseGrowth()) {
            if (this.server.config.powerupGrowthEvery) client.lastUsedGrowth = this.server.ticks;
            return;
        }
        var max  = this.server.config.growthPelletMaxAmount || 3;
        var live = this.server.nodesGrowthPellets.filter(function(p) { return p.spawner === client; }).length;
        if (live >= max) return;

        var pellet = this.server.spawnGrowthPellet(client.mouse, client);
        if (pellet) client.lastUsedGrowth = this.server.ticks;
    }
    /**
     * F key — toggle freeze/thaw for the player's own cells.
     */
    message_onKeyF(message) {
        var client = this.socket.playerTracker;
        if (client.spectate || client.cells.length === 0) return;

        client.cellsFrozen = !client.cellsFrozen;

        if (client.cellsFrozen) {
            for (var i = 0; i < client.cells.length; i++) {
                var cell = client.cells[i];
                if (cell.vel) {
                    cell.vel.x = 0;
                    cell.vel.y = 0;
                }
                cell.boostDistance = 0;
                cell.isMoving = false;
            }
        } else {
            this.server.thawPlayer(client);
        }
    }
    /**
     * W keydown — begin macro eject. Sets wHeld so process() fires ejectMass
     * every tick while held, throttled by ejectCooldown.
     */
    message_onKeyW(message) {
        if (message.length !== 1)
            return;
        if (this.socket.playerTracker.miQ) {
            this.socket.playerTracker.minionEject = true;
        } else {
            this.wHeld = true;
            // Also fire one immediate eject on keydown (single-tap still works)
            this.pressW = true;
        }
    }
    /**
     * Opcode 29: W keyup — stop macro eject.
     * The client must send opcode 29 on keyup for hold-to-macro to work.
     */
    message_onKeyWRelease(message) {
        this.wHeld = false;
    }
    message_onKeyE(message) {
        if (this.server.config.disableERTP)
            return;
        this.socket.playerTracker.minionSplit = true;
    }
    message_onKeyR(message) {
        if (this.server.config.disableERTP)
            return;
        this.socket.playerTracker.minionEject = true;
    }
    message_onKeyT(message) {
        if (this.server.config.disableERTP)
            return;
        this.socket.playerTracker.minionFrozen = !this.socket.playerTracker.minionFrozen;
    }
    message_onKeyG(message) {
        var client = this.socket.playerTracker;
        if (!this.server.config.powerupRecombine || !client.canUseRecombine()) {
            if (this.server.config.powerupRecombineEvery) client.lastUsedRecombine = this.server.ticks;
            return;
        }
        if (client.spectate) return;
        if (client.cells.length > 1) client.mergeOverride = true;
        client.lastUsedRecombine = this.server.ticks;
    }
    message_onChat(message) {
        if (message.length < 3)
            return;
        var tick = this.server.ticks;
        var dt = tick - this.lastChatTick;
        this.lastChatTick = tick;
        if (dt < 25 * 2) {
            return;
        }
        var flags = message[1]; // flags
        var rvLength = (flags & 2 ? 4 : 0) + (flags & 4 ? 8 : 0) + (flags & 8 ? 16 : 0);
        if (message.length < 3 + rvLength) // second validation
            return;
        var reader = new BinaryReader(message);
        reader.skipBytes(2 + rvLength); // reserved
        var text = null;
        if (this.protocol < 6)
            text = reader.readStringZeroUnicode();
        else
            text = reader.readStringZeroUtf8();
        this.server.onChatMessage(this.socket.playerTracker, null, text);
    }
    message_onStat(message) {
        if (message.length !== 1)
            return;
        var tick = this.server.ticks;
        var dt = tick - this.lastStatTick;
        this.lastStatTick = tick;
        if (dt < 25) {
            return;
        }
        this.sendPacket(new Packet.ServerStat(this.socket.playerTracker));
    }
    processMouse() {
        if (this.mouseData == null)
            return;
        var client = this.socket.playerTracker;
        var reader = new BinaryReader(this.mouseData);
        reader.skipBytes(1);
        if (this.mouseData.length === 13) {
            // protocol late 5, 6, 7
            client.mouse.x = reader.readInt32() - client.scrambleX;
            client.mouse.y = reader.readInt32() - client.scrambleY;
        }
        else if (this.mouseData.length === 9) {
            // early protocol 5
            client.mouse.x = reader.readInt16() - client.scrambleX;
            client.mouse.y = reader.readInt16() - client.scrambleY;
        }
        else if (this.mouseData.length === 21) {
            // protocol 4
            client.mouse.x = ~~reader.readDouble() - client.scrambleX;
            client.mouse.y = ~~reader.readDouble() - client.scrambleY;
        }
        this.mouseData = null;
    }
    process() {
        // FIX: processMouse() must run FIRST so client.mouse is fresh before
        // movePlayer() reads it this tick to build cell.vel for wave physics.
        this.processMouse();
        if (this.pressSpace) { // Split cell
            this.socket.playerTracker.pressSpace();
            this.pressSpace = false;
        }
        if (this.pressW) { // Single eject on keydown
            this.socket.playerTracker.pressW();
            this.pressW = false;
        }
        // Macro eject: fire every tick while W is held, throttled by ejectCooldown
        if (this.wHeld && !this.pressW) {
            var cooldown = this.server.config.ejectCooldown || 3;
            var dt = this.server.ticks - this.lastMacroEjectTick;
            if (dt >= cooldown) {
                this.socket.playerTracker.pressW();
                this.lastMacroEjectTick = this.server.ticks;
            }
        }
        if (this.pressQ) { // Q Press
            this.socket.playerTracker.pressQ();
            this.pressQ = false;
        }
        if (this.socket.playerTracker.minionSplit) {
            this.socket.playerTracker.minionSplit = false;
        }
        if (this.socket.playerTracker.minionEject) {
            this.socket.playerTracker.minionEject = false;
        }
    }
    getRandomSkin() {
        var randomSkins = [];
        var fs = require("fs");
        if (fs.existsSync("../src/randomskins.txt")) {
            // Read and parse the Skins - filter out whitespace-only Skins
            randomSkins = fs.readFileSync("../src/randomskins.txt", "utf8").split(/[\r\n]+/).filter(function (x) {
                return x != ''; // filter empty Skins
            });
        }
        // Picks a random skin
        if (randomSkins.length > 0) {
            var index = (randomSkins.length * Math.random()) >>> 0;
            var rSkin = randomSkins[index];
        }
        return rSkin;
    }
    setNickname(text) {
        var name = "", skin = null;
        if (text != null && text.length > 0) {
            var skinName = null, userName = text, n = -1;
            if (text[0] == '<' && (n = text.indexOf('>', 1)) >= 1) {
                var inner = text.slice(1, n);
                if (n > 1)
                    skinName = (inner == "r") ? this.getRandomSkin() : inner;
                else
                    skinName = "";
                userName = text.slice(n + 1);
            }
            skin = skinName;
            name = userName;
        }
        if (name.length > this.server.config.playerMaxNickLength)
            name = name.substring(0, this.server.config.playerMaxNickLength);
        if (this.server.checkBadWord(name)) {
            skin = null;
            name = "Hi there!";
        }
        this.socket.playerTracker.joinGame(name, skin);
    }
    sendPacket(packet) {
        var socket = this.socket;
        if (!packet || !socket.isConnected || socket.playerTracker.isMi ||
            socket.playerTracker.isBot) return;
        if (socket.readyState == this.server.WebSocket.OPEN) {
            var buffer = packet.build(this.protocol);
            if (buffer)
                socket.send(buffer, { binary: true });
        }
        else {
            socket.terminate();
        }
    }
}

module.exports = PacketHandler;
