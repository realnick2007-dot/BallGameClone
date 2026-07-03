// Library imports
var http = require('http');

// Project imports
var Entity = require('./entity/indexEntity');
var Vec2 = require('./modules/Vec2');
var Logger = require('./modules/Logger');
var {QuadNode, Quad} = require('./modules/QuadNode.js');
const { callbackify } = require('util');

// Server implementation
class Server {
    constructor() {
        // Location of source files - For renaming or moving source files!
        this.srcFiles = "../src";

        // Startup
        this.run = true;
        this.version = '1.6.2';
        this.httpServer = null;
        this.lastNodeId = 1;
        this.lastPlayerId = 1;
        this.clients = [];
        this.socketCount = 0;
        this.largestClient = null; // Required for spectators
        this.nodes = []; // Total nodes
        this.nodesVirus = []; // Virus nodes
	this.nodesGrowthPellets = []; // Growth nodes
        this.nodesFood = []; // Food nodes
        this.nodesEjected = []; // Ejected nodes
        this.nodesPlayer = []; // Player nodes
        this.nodesCoins = []; // Coin nodes
        this.movingNodes = []; // For move engine
        this.leaderboard = []; // For leaderboard
        this.leaderboardType = -1; // No type
        var BotLoader = require('./ai/BotLoader');
        this.bots = new BotLoader(this);

        // Main loop tick
        this.startTime = Date.now();
        this.stepDateTime = 0;
        this.timeStamp = 0;
        this.updateTime = 0;
        this.updateTimeAvg = 0;
        this.timerLoopBind = null;
        this.mainLoopBind = null;
        this.ticks = 0;
        this.disableSpawn = false;

        // Config
        this.config = require("./config.js");
        this.ipBanList = [];
        this.minionTest = [];
        this.userList = [];
        this.badWords = [];
        this.loadFiles();

        // Set border, quad-tree
        this.setBorder(this.config.borderWidth, this.config.borderHeight);
        this.quadTree = new QuadNode(this.border);
    }

    // -------------------------------------------------------------------------
    // Recombine / grace / bloom helpers — single source of truth
    // All grace, bloom, and merge-eligibility checks in the server use these.
    // Override via config.splitGraceTime and config.splitBloomTime.
    // -------------------------------------------------------------------------

    /** Ticks a freshly-split cell phases through teammates before rigid collision kicks in. */
    getSplitGraceTime() {
        if (this.config.splitGraceTime !== undefined) return this.config.splitGraceTime;
        return this.config.mobilePhysics ? 1 : 13;
    }

    /** Ticks after grace ends over which the rigid push force cubic-ramps to full (~0.5s at 40ms/tick). */
    getSplitBloomTime() {
        return this.config.splitBloomTime !== undefined ? this.config.splitBloomTime : 13;
    }

    /** True while a cell is still inside its post-split grace window. */
    isInSplitGrace(cell) {
        return cell.getAge() < this.getSplitGraceTime();
    }

    /**
     * True when two same-owner cells are allowed to merge.
     * Centralises every merge-eligibility condition in one place:
     *   - mergeOverride (recombine powerup) always allows merging
     *   - either cell still in grace period blocks merging
     *   - both cells must have _canRemerge set by movePlayer()
     */
    canOwnedCellsMerge(a, b) {
        if (!a || !b || !a.owner || a.owner !== b.owner) return false;
        if (a.owner.mergeOverride) return true;
        if (this.isInSplitGrace(a) || this.isInSplitGrace(b)) return false;
        return a._canRemerge && b._canRemerge;
    }

    // -------------------------------------------------------------------------

    /**
     * Thaws a previously frozen player, immediately skipping all grace/bloom
     * delay windows so normal physics (rigid collisions, wave impulse, remerge)
     * kick in on the very next tick.
     */
    thawPlayer(client) {
        var skipTicks = this.getSplitGraceTime() + this.getSplitBloomTime();
        for (var i = 0; i < client.cells.length; i++) {
            var cell = client.cells[i];
            cell.createdAt = this.ticks - skipTicks - 1;
            cell._canRemerge = true;
            if (cell.vel) {
                cell.vel.x = 0;
                cell.vel.y = 0;
            }
            cell.boostDistance = 0;
            cell.isMoving = false;
        }
    }

    start() {
        this.timerLoopBind = this.timerLoop.bind(this);
        this.mainLoopBind = this.mainLoop.bind(this);
        // Set up gamemode(s)
        var Gamemode = require('./gamemodes');
        this.mode = Gamemode.get(this.config.serverGamemode);
        this.mode.onServerInit(this);
        // Client Binding
        var bind = this.config.clientBind + "";
        this.clientBind = bind.split(' - ');
        // Start the server
        this.httpServer = http.createServer();
        var wsOptions = {
            server: this.httpServer,
            perMessageDeflate: false,
            maxPayload: 4096
        };
        Logger.info("WebSocket: " + this.config.serverWsModule);
        this.WebSocket = require(this.config.serverWsModule);
        this.wsServer = new this.WebSocket.Server(wsOptions);
        this.wsServer.on('error', this.onServerSocketError.bind(this));
        this.wsServer.on('connection', this.onClientSocketOpen.bind(this));
        this.httpServer.listen(this.config.serverPort, this.config.serverBind, this.onHttpServerOpen.bind(this));
        // Start stats port (if needed)
        if (this.config.serverStatsPort > 0) {
            this.startStatsServer(this.config.serverStatsPort);
        }
    }
    onHttpServerOpen() {
        // Start Main Loop
        setTimeout(this.timerLoopBind, 1);
        // Done
        Logger.info("Game server started, on port " + this.config.serverPort);
        Logger.info("Current game mode is " + this.mode.name);
        // Player bots (Experimental)
        if (this.config.serverBots) {
            for (var i = 0; i < this.config.serverBots; i++)
                this.bots.addBot();
            Logger.info("Added " + this.config.serverBots + " player bots");
        }
        this.spawnCells(this.config.virusAmount, this.config.foodAmount);
        // Spawn initial coins
        var coinAmount = this.config.coinAmount || 50;
        for (var i = 0; i < coinAmount; i++) {
            this.spawnCoin();
        }
    }
    addNode(node) {
        // Add to quad-tree & node list
        var x = node.position.x;
        var y = node.position.y;
        var s = node._size;
        node.quadItem = {
            cell: node,
            bound: new Quad(x - s, y - s, x + s, y + s)
        };
        this.quadTree.insert(node.quadItem);
        this.nodes.push(node);
        // Special on-add actions
        node.onAdd(this);
    }
    onServerSocketError(error) {
        Logger.error("WebSocket: " + error.code + " - " + error.message);
        switch (error.code) {
            case "EADDRINUSE":
                Logger.error("Server could not bind to port " + this.config.serverPort + "!");
                Logger.error("Please close out of Skype or change 'serverPort' in the config to a different number.");
                break;
            case "EACCES":
                Logger.error("Please make sure you are running MultiOgarII-Continued with root privileges.");
                break;
        }
        process.exit(1); // Exits the program
    }
    onClientSocketOpen(ws, req) {
        var req = req || ws.upgradeReq;
        var logip = ws._socket.remoteAddress + ":" + ws._socket.remotePort;
        ws.on('error', function (err) {
            Logger.writeError("[" + logip + "] " + err.stack);
        });
        if (this.config.serverMaxConnections && this.socketCount >= this.config.serverMaxConnections) {
            ws.close(1000, "No slots");
            return;
        }
        if (this.checkIpBan(ws._socket.remoteAddress)) {
            ws.close(1000, "IP banned");
            return;
        }
        if (this.config.serverIpLimit) {
            var ipConnections = 0;
            for (var i = 0; i < this.clients.length; i++) {
                var socket = this.clients[i];
                if (!socket.isConnected || socket.remoteAddress != ws._socket.remoteAddress)
                    continue;
                ipConnections++;
            }
            if (ipConnections >= this.config.serverIpLimit) {
                ws.close(1000, "IP limit reached");
                return;
            }
        }
        if (this.config.clientBind.length && req.headers.origin.indexOf(this.clientBind) < 0) {
            ws.close(1000, "Client not allowed");
            return;
        }
        ws.isConnected = true;
        ws.remoteAddress = ws._socket.remoteAddress;
        ws.remotePort = ws._socket.remotePort;
        ws.lastAliveTime = Date.now();
        Logger.write("CONNECTED " + ws.remoteAddress + ":" + ws.remotePort + ", origin: \"" + req.headers.origin + "\"");
        var PlayerTracker = require('./PlayerTracker');
        ws.playerTracker = new PlayerTracker(this, ws);
        var PacketHandler = require('./PacketHandler');
        ws.packetHandler = new PacketHandler(this, ws);
        var PlayerCommand = require('./modules/PlayerCommand');
        ws.playerCommand = new PlayerCommand(this, ws.playerTracker);
        var self = this;
        ws.on('message', function (message) {
            if (self.config.serverWsModule === "uws")
                message = parseInt(process.version[1]) < 6 ? Buffer.from(message) : Buffer.from(message);
            if (!message.length)
                return;
            if (message.length > 256) {
                ws.close(1009, "Spam");
                return;
            }
            ws.packetHandler.handleMessage(message);
        });
        ws.on('error', function (error) {
            ws.packetHandler.sendPacket = function (data) { };
        });
        ws.on('close', function (reason) {
            if (ws._socket && ws._socket.destroy != null && typeof ws._socket.destroy == 'function') {
                ws._socket.destroy();
            }
            self.socketCount--;
            ws.isConnected = false;
            ws.packetHandler.sendPacket = function (data) { };
            ws.closeReason = {
                reason: ws._closeCode,
                message: ws._closeMessage
            };
            ws.closeTime = Date.now();
            Logger.write("DISCONNECTED " + ws.remoteAddress + ":" + ws.remotePort + ", code: " + ws._closeCode +
                ", reason: \"" + ws._closeMessage + "\", name: \"" + ws.playerTracker._name + "\"");
        });
        this.socketCount++;
        this.clients.push(ws);
        // Check for external minions
        this.checkMinion(ws, req);
    }
    checkMinion(ws, req) {
        if (!req.headers['user-agent'] || !req.headers['cache-control'] ||
            req.headers['user-agent'].length < 50) {
            ws.playerTracker.isMinion = true;
        }
        if (this.config.serverMinionThreshold) {
            if ((ws.lastAliveTime - this.startTime) / 1000 >= this.config.serverMinionIgnoreTime) {
                if (this.minionTest.length >= this.config.serverMinionThreshold) {
                    ws.playerTracker.isMinion = true;
                    for (var i = 0; i < this.minionTest.length; i++) {
                        var playerTracker = this.minionTest[i];
                        if (!playerTracker.socket.isConnected)
                            continue;
                        playerTracker.isMinion = true;
                    }
                    if (this.minionTest.length)
                        this.minionTest.splice(0, 1);
                }
                this.minionTest.push(ws.playerTracker);
            }
        }
        if (this.config.serverMinions && !ws.playerTracker.isMinion) {
            for (var i = 0; i < this.config.serverMinions; i++) {
                this.bots.addMinion(ws.playerTracker);
            }
        }
    }
    checkIpBan(ipAddress) {
        if (!this.ipBanList || !this.ipBanList.length || ipAddress == "127.0.0.1") {
            return false;
        }
        if (this.ipBanList.indexOf(ipAddress) >= 0) {
            return true;
        }
        var ipBin = ipAddress.split('.');
        if (ipBin.length != 4) {
            return false;
        }
        var subNet2 = ipBin[0] + "." + ipBin[1] + ".*.*";
        if (this.ipBanList.indexOf(subNet2) >= 0) {
            return true;
        }
        var subNet1 = ipBin[0] + "." + ipBin[1] + "." + ipBin[2] + ".*";
        if (this.ipBanList.indexOf(subNet1) >= 0) {
            return true;
        }
        return false;
    }
    setBorder(width, height) {
        var hw = width / 2;
        var hh = height / 2;
        this.border = new Quad(-hw, -hh, hw, hh);
        this.border.width = width;
        this.border.height = height;
    }
    getRandomColor() {
        var colorRGB = [0xFF, 0x07, (Math.random() * 256) >> 0];
        colorRGB.sort(function () {
            return 0.5 - Math.random();
        });
        return {
            r: colorRGB[0],
            g: colorRGB[1],
            b: colorRGB[2]
        };
    }
    removeNode(node) {
        node.isRemoved = true;
        this.quadTree.remove(node.quadItem);
        node.quadItem = null;
        var i = this.nodes.indexOf(node);
        if (i > -1)
            this.nodes.splice(i, 1);
        i = this.movingNodes.indexOf(node);
        if (i > -1)
            this.movingNodes.splice(i, 1);
        node.onRemove(this);
    }
    updateClients() {
        var len = this.clients.length;
        for (var i = 0; i < len;) {
            if (!this.clients[i]) {
                i++;
                continue;
            }
            this.clients[i].playerTracker.checkConnection();
            if (this.clients[i].playerTracker.isRemoved || this.clients[i].isCloseRequest)
                this.clients.splice(i, 1);
            else
                i++;
        }
        for (var i = 0; i < len; i++) {
            if (!this.clients[i])
                continue;
            this.clients[i].playerTracker.updateTick();
        }
        for (var i = 0; i < len; i++) {
            if (!this.clients[i])
                continue;
            this.clients[i].playerTracker.sendUpdate();
        }
        for (var i = 0, test = this.minionTest.length; i < test;) {
            if (!this.minionTest[i]) {
                i++;
                continue;
            }
            var date = new Date() - this.minionTest[i].connectedTime;
            if (date > this.config.serverMinionInterval)
                this.minionTest.splice(i, 1);
            else
                i++;
        }
    }
    updateLeaderboard() {
        this.leaderboard = [];
        this.leaderboardType = -1;
        this.mode.updateLB(this, this.leaderboard);
        if (!this.mode.specByLeaderboard) {
            var clients = this.clients.valueOf();
            clients.sort(function (a, b) {
                return b.playerTracker._score - a.playerTracker._score;
            });
            this.largestClient = null;
            if (clients[0])
                this.largestClient = clients[0].playerTracker;
        }
        else {
            this.largestClient = this.mode.rankOne;
        }
    }
    onChatMessage(from, to, message) {
        if (!message || !(message = message.trim()))
            return;
        if (!this.config.serverChat || (from && from.isMuted)) {
            return;
        }
        if (from && message.length && message[0] == '/') {
            from.socket.playerCommand.processMessage(from, message);
            return;
        }
        if (message.length > 64) {
            message = message.slice(0, 64);
        }
        if (this.config.serverChatAscii) {
            for (var i = 0; i < message.length; i++) {
                if ((message.charCodeAt(i) < 0x20 || message.charCodeAt(i) > 0x7F) && from) {
                    this.sendChatMessage(null, from, "Message failed - You can use ASCII text only!");
                    return;
                }
            }
        }
        if (this.checkBadWord(message) && from && this.config.badWordFilter === 1) {
            this.sendChatMessage(null, from, "Message failed - Stop insulting others! Keep calm and be friendly please.");
            return;
        }
        this.sendChatMessage(from, to, message);
    }
    checkBadWord(value) {
        if (!value)
            return false;
        value = " " + value.toLowerCase().trim() + " ";
        for (var i = 0; i < this.badWords.length; i++) {
            if (value.indexOf(this.badWords[i]) >= 0) {
                return true;
            }
        }
        return false;
    }
    sendChatMessage(from, to, message) {
        for (var i = 0, len = this.clients.length; i < len; i++) {
            if (!this.clients[i])
                continue;
            if (!to || to == this.clients[i].playerTracker) {
                var Packet = require('./packet');
                if (this.config.separateChatForTeams && this.mode.haveTeams) {
                    if (from == null || from.team === this.clients[i].playerTracker.team) {
                        this.clients[i].packetHandler.sendPacket(new Packet.ChatMessage(from, message));
                    }
                }
                else {
                    this.clients[i].packetHandler.sendPacket(new Packet.ChatMessage(from, message));
                }
            }
        }
    }
    timerLoop() {
        var timeStep = 40; // vanilla: 40
        var ts = Date.now();
        var dt = ts - this.timeStamp;
        if (dt < timeStep - 5) {
            setTimeout(this.timerLoopBind, timeStep - 5);
            return;
        }
        if (dt > 120)
            this.timeStamp = ts - timeStep;
        this.updateTimeAvg += 0.5 * (this.updateTime - this.updateTimeAvg);
        this.timeStamp += timeStep;
        setTimeout(this.mainLoopBind, 0);
        setTimeout(this.timerLoopBind, 0);
    }
    mainLoop() {
        this.stepDateTime = Date.now();
        var tStart = process.hrtime();
        var self = this;
        // Restart
        if (this.ticks > this.config.serverRestart) {
            this.httpServer = null;
            this.wsServer = null;
            this.run = true;
            this.lastNodeId = 1;
            this.lastPlayerId = 1;
            for (var i = 0; i < this.clients.length; i++) {
                var client = this.clients[i];
                client.close();
            }
            ;
            this.nodes = [];
            this.nodesVirus = [];
            this.nodesFood = [];
            this.nodesEjected = [];
            this.nodesPlayer = [];
            this.nodesCoins = [];
            this.movingNodes = [];
            if (this.config.serverBots) {
                for (var i = 0; i < this.config.serverBots; i++)
                    this.bots.addBot();
                Logger.info("Added " + this.config.serverBots + " player bots");
            }
            ;
            this.commands;
            this.ticks = 0;
            this.startTime = Date.now();
            this.setBorder(this.config.borderWidth, this.config.borderHeight);
            this.quadTree = new QuadNode(this.border, 64, 32);
        }
        ;
        // Loop main functions
        if (this.run) {
            var movingSnapshot = this.movingNodes.slice();
            movingSnapshot.forEach((cell) => {
                if (cell.isRemoved)
                    return;
                this.boostCell(cell);
                this.quadTree.find(cell.quadItem.bound, function (check) {
                    var m = self.checkCellCollision(cell, check);
                    if (cell.type == 3 && check.type == 3 && !self.config.mobilePhysics)
                        self.resolveRigidCollision(m);
                    else
                        self.resolveCollision(m);
                });
                if (!cell.isMoving) {
                    var idx = self.movingNodes.indexOf(cell);
                    if (idx > -1) self.movingNodes.splice(idx, 1);
                }
            });

            var eatCollisions = [];
            var playerSnapshot = this.nodesPlayer.slice();
            playerSnapshot.forEach((cell) => {
                if (cell.isRemoved)
                    return;

                this.movePlayer(cell, cell.owner);
                this.boostCell(cell);

                if (!cell.isRemoved)
                    this.updateNodeQuad(cell);

                if (!cell.isRemoved) {
                    this.quadTree.find(cell.quadItem.bound, function (check) {
                        var m = self.checkCellCollision(cell, check);
                        if (self.checkRigidCollision(m))
                            self.resolveRigidCollision(m);
                        else if (check != cell)
                            eatCollisions.unshift(m);
                    });
                }

                if (!cell.isRemoved) {
                    this.autoSplit(cell, cell.owner);
                    if (((this.ticks + 3) % 25) === 0)
                        this.updateSizeDecay(cell);
                    if (cell.owner.isMinion) {
                        cell.owner.socket.close(1000, "Minion");
                        this.removeNode(cell);
                    }
                }
            });
            eatCollisions.forEach((m) => {
                this.resolveCollision(m);
            });
            // Remove dead viruses
            if (this.config.virusLifeTime) {
                var virusSnapshot = this.nodesVirus.slice();
                virusSnapshot.forEach(virus => {
                    if (virus.isRemoved) return;
                    if (this.ticks >= virus.createdAt + this.config.virusLifeTime * 25)
                        this.removeNode(virus);
                });
            }
            // Remove expired growth pellets
            if (this.config.growthPelletLifeTime) {
                var pelletSnapshot = this.nodesGrowthPellets.slice();
                pelletSnapshot.forEach(pellet => {
                    if (pellet.isRemoved) return;
                    if (this.ticks >= pellet.createdAt + this.config.growthPelletLifeTime * 25)
                        this.removeNode(pellet);
                });
            }
            this.mode.onTick(this);
            this.ticks++;
        }
        if (!this.run && this.mode.IsTournament)
            this.ticks++;
        this.updateClients();
        if (((this.ticks + 7) % 25) === 0)
            this.updateLeaderboard();
        if (this.config.serverTracker && (this.ticks % 750) === 0)
            this.pingServerTracker();
        var tEnd = process.hrtime(tStart);
        this.updateTime = tEnd[0] * 1e3 + tEnd[1] / 1e6;
    }
    movePlayer(cell, client) {
        if (client.socket.isConnected == false || client.cellsFrozen || !client.mouse)
            return;

        if (client.mergeOverride && client.cells.length > 1) {
            var anchorCell = null;
            var anchorDist = Infinity;
            for (var i = 0; i < client.cells.length; i++) {
                var cd = client.mouse.difference(client.cells[i].position).dist();
                if (cd < anchorDist) {
                    anchorDist = cd;
                    anchorCell = client.cells[i];
                }
            }

            var bonusSpeed = this.config.recombineBoostSpeed !== undefined
                ? this.config.recombineBoostSpeed
                : 150;

            if (cell === anchorCell) {
                var d = client.mouse.difference(cell.position);
                var dist = d.dist();
                var move = cell.getSpeed(dist);
                if (move) cell.position.add(d.product(move));
            } else {
                var target = anchorCell ? anchorCell.position : client.mouse;
                var d = target.difference(cell.position);
                var dist = d.dist();
                if (dist > 0) {
                    var baseWorldSpeed = cell.getSpeed(dist) * dist;
                    var totalWorldSpeed = baseWorldSpeed + bonusSpeed;
                    totalWorldSpeed = Math.min(totalWorldSpeed, dist);
                    cell.position.add(d.product(totalWorldSpeed / dist));
                }
            }

            cell._canRemerge = true;
            return;
        }

        var d = client.mouse.difference(cell.position);
        var dist = d.dist();
        var move = cell.getSpeed(dist);

        var friction = this.config.cellFriction !== undefined ? this.config.cellFriction : 0.82;

        if (!move) {
            if (cell.vel) {
                cell.vel.x *= friction;
                cell.vel.y *= friction;
            }
            return;
        }

var velScale = this.config.cellVelScale !== undefined ? this.config.cellVelScale : 0.8;

var axisSnapThreshold = this.config.axisSnapThreshold !== undefined ? this.config.axisSnapThreshold : 0.08;
var dirX = d.x;
var dirY = d.y;
var absX = Math.abs(dirX);
var absY = Math.abs(dirY);

if (absX > absY && absY < axisSnapThreshold) {
    dirX = dirX > 0 ? 1 : -1;
    dirY = 0;
} else if (absY > absX && absX < axisSnapThreshold) {
    dirX = 0;
    dirY = dirY > 0 ? 1 : -1;
}

var stepX = dirX * move;
var stepY = dirY * move;

if (cell.vel) {
    var distNorm = Math.min(dist / 2000, 1);
    var blend = 0.5 + distNorm * 0.3;

    cell.vel.x = cell.vel.x * (1 - blend) + stepX * velScale * blend;
    cell.vel.y = cell.vel.y * (1 - blend) + stepY * velScale * blend;
    cell.position.x += cell.vel.x;
    cell.position.y += cell.vel.y;
    cell.vel.x *= friction;
    cell.vel.y *= friction;
} else {
    cell.position.add(d.product(move));
}

        var time = this.config.playerRecombineTime, base = Math.max(time, cell._size * 0.2) * 25;
        if (!time || client.rec || client.mergeOverride) {
            var nearest_dist = 10 ** 9, nearest_id;
            for (var _cell of client.cells) {
                var _dist = client.mouse.difference(_cell.position).dist();
                if (_dist < nearest_dist) {
                    nearest_dist = _dist;
                    nearest_id = _cell.nodeId;
                }
            }
            if (cell.nodeId != nearest_id) {
                cell.speed = (client.speed ? client.speed : this.config.playerSpeed) * 5;
            }
            cell._canRemerge = cell.boostDistance < 100;
            return;
        } else {
            cell.speed = 0;
        }
        cell._canRemerge = cell.getAge() >= base;
    }
    updateSizeDecay(cell) {
        var rate = this.config.playerDecayRate, cap = this.config.playerDecayCap;
        if (!rate || cell._size <= this.config.playerMinSize)
            return;
        if (cap && cell._mass > cap)
            rate *= 10;
        var decay = 1 - rate * this.mode.decayMod;
        cell.setSize(Math.sqrt(cell.radius * decay));
    }
    boostCell(cell) {
        if (cell.isMoving && !cell.boostDistance || cell.isRemoved) {
            cell.boostDistance = 0;
            cell.isMoving = false;
            return;
        }
        var speed = cell.boostDistance / 9;
        cell.boostDistance -= speed;
        cell.position.add(cell.boostDirection.product(speed));
        cell.checkBorder(this.border);
        this.updateNodeQuad(cell);
    }
    autoSplit(cell, client) {
        if (client.rec)
            var maxSize = 1e9;
        else
            maxSize = this.config.playerMaxSize;
        if (cell._size < maxSize)
            return;
        if (client.cells.length >= this.config.playerAutosplitCells || this.config.mobilePhysics) {
            cell.setSize(maxSize);
        }
        else {
            var angle = Math.random() * 2 * Math.PI;
            this.splitPlayerCell(client, cell, angle, cell._mass * .5);
        }
    }
    updateNodeQuad(node) {
        var item = node.quadItem.bound;
        item.minx = node.position.x - node._size;
        item.miny = node.position.y - node._size;
        item.maxx = node.position.x + node._size;
        item.maxy = node.position.y + node._size;
        this.quadTree.remove(node.quadItem);
        this.quadTree.insert(node.quadItem);
    }
    checkCellCollision(cell, check) {
        var p = check.position.difference(cell.position);
        return {
            cell: cell,
            check: check,
            d: p.dist(),
            p: p
        };
    }
    checkRigidCollision(m) {
        if (!m.cell.owner || !m.check.owner)
            return false;
        if (m.cell.owner != m.check.owner) {
            if (this.mode.haveTeams && m.check.owner.isMi || m.cell.owner.isMi && this.config.minionCollideTeam === 0) {
                return false;
            } else {
                return this.mode.haveTeams &&
                    m.cell.owner.team == m.check.owner.team;
            }
        }
        if (this.isInSplitGrace(m.cell) || this.isInSplitGrace(m.check)) {
            return false;
        }
        return !this.canOwnedCellsMerge(m.cell, m.check);
    }
    resolveRigidCollision(m) {
        var dx = m.p.x;
        var dy = m.p.y;
        var d  = m.d;
        // Avoid divide-by-zero when two cells are perfectly overlapping
        if (d < 0.01) {
            dx = 1;
            dy = 0;
            d  = 1;
        }
        var push = (m.cell._size + m.check._size - d);
        if (push <= 0) return;

        var grace = this.getSplitGraceTime();
        var bloom = this.getSplitBloomTime();
        var ageA  = m.cell.getAge();
        var ageB  = m.check.getAge();
        var age   = Math.min(ageA, ageB);

        // Bloom ramp: 0 right after grace ends, 1 when bloom window finishes
        var bloomProgress = bloom > 0 ? Math.min((age - grace) / bloom, 1) : 1;
        var ramp = bloomProgress * bloomProgress * bloomProgress; // cubic
        push *= ramp;
        if (push <= 0) return;

        // Split evenly between the two cells
        var massA = m.cell._mass  || 1;
        var massB = m.check._mass || 1;
        var total = massA + massB;
        var ratioA = massB / total;
        var ratioB = massA / total;

        var nx = dx / d;
        var ny = dy / d;

        m.check.position.x += nx * push * ratioA;
        m.check.position.y += ny * push * ratioA;
        m.cell.position.x  -= nx * push * ratioB;
        m.cell.position.y  -= ny * push * ratioB;

        // --- WAVE PHYSICS impulse transfer ---
        if (m.cell.vel && m.check.vel) {
            var restitution = this.config.cellRestitution !== undefined ? this.config.cellRestitution : 0.35;
            var waveBias    = this.config.waveBias       !== undefined ? this.config.waveBias       : 0.6;

            // Relative velocity along the collision normal (check minus cell)
            var relVx = m.check.vel.x - m.cell.vel.x;
            var relVy = m.check.vel.y - m.cell.vel.y;
            var relVn = relVx * nx + relVy * ny;

            // Travel-axis vector (blend of velocity direction and normal)
            var speed = Math.sqrt(m.cell.vel.x ** 2 + m.cell.vel.y ** 2) || 1;
            var tx = m.cell.vel.x / speed;
            var ty = m.cell.vel.y / speed;
            var bx = nx * (1 - waveBias) + tx * waveBias;
            var by = ny * (1 - waveBias) + ty * waveBias;
            var blen = Math.sqrt(bx * bx + by * by) || 1;
            bx /= blen;  by /= blen;

            var jn = -(1 + restitution) * relVn / (1 / massA + 1 / massB);

            if (jn > 0) {
                var jx = jn * bx;
                var jy = jn * by;
                m.cell.vel.x  -= jx / massA;
                m.cell.vel.y  -= jy / massA;
                m.check.vel.x += jx / massB;
                m.check.vel.y += jy / massB;
            }
        }
    }
    resolveCollision(m) {
        var cell  = m.cell;
        var check = m.check;
        if (cell.isRemoved || check.isRemoved) return;

        // ── Coin pickup: a player/minion cell overlaps a Coin ──────────────────
        // The larger-eats-smaller rule is bypassed entirely for coins: any
        // player cell that touches a coin collects it regardless of size.
        if (check.type === 6 && (cell.type === 0 || cell.owner)) {
            // Only collect if the cells are overlapping (centres within sum of radii)
            if (m.d < cell._size + check._size) {
                this.removeNode(check);
                check.onEaten(cell);
            }
            return;
        }
        if (cell.type === 6 && (check.type === 0 || check.owner)) {
            if (m.d < check._size + cell._size) {
                this.removeNode(cell);
                cell.onEaten(check);
            }
            return;
        }
        // ── End coin pickup ────────────────────────────────────────────────────

        if (check._size > cell._size) {
            cell  = m.check;
            check = m.cell;
        }
        // Eat condition: larger must cover smaller's centre (dist < larger._size)
        if (m.d >= cell._size) return;
        // Larger cell must be big enough to eat (10% mass rule)
        if (cell._size < check._size * 1.14) return;
        if (!cell.canEat(check)) return;
        // Remove prey
        cell.onEat(check);
        check.onEaten(cell);
        this.removeNode(check);
    }
    splitPlayerCell(client, cell, angle, mass) {
        var size = Math.sqrt(mass * 100);
        var size1 = Math.sqrt(cell._mass * 100 - mass * 100);
        // Size check
        if (size < this.config.playerMinSplitSize || size1 < this.config.playerMinSplitSize) {
            return;
        }
        // Split
        var newCell = new Entity.PlayerCell(this, client, cell.position, size);
        newCell.setBoost(this.config.splitVelocity * Math.pow(size / this.config.playerMaxSize, 0.5), angle);
        this.addNode(newCell);
        // Reduce size of original
        cell.setSize(size1);
    }
    spawnCells(virusAmount, foodAmount) {
        for (var i = 0; i < foodAmount; i++) {
            var food = new Entity.Food(this, null, this.getRandomPosition(), this.config.foodMinSize);
            if (this.config.foodMassGrow) {
                var maxGrow = this.config.foodMaxSize - food._size;
                food.setSize(food._size += maxGrow * Math.random());
            }
            food.color = this.getRandomColor();
            this.addNode(food);
        }
        for (var i = 0; i < virusAmount; i++) {
            var virus = new Entity.Virus(this, null, this.getRandomPosition(), this.config.virusMinSize);
            this.addNode(virus);
        }
    }
    /**
     * Spawns a single Coin at a random map position if the current live coin
     * count is below config.coinAmount. Called both from onHttpServerOpen
     * (batch initial spawn) and from Coin.onRemove (auto-respawn on pickup).
     *
     * Fix: do NOT push into nodesCoins here. Coin.onAdd() handles that.
     */
    spawnCoin() {
        var maxCoins = this.config.coinAmount || 50;
        if (this.nodesCoins.length >= maxCoins) return;
        var position = this.getRandomPosition();
        var size = this.config.coinSize || 30;
        var coin = new Entity.Coin(this, null, position, size);
        this.addNode(coin); // onAdd() pushes into nodesCoins
    }
    spawnPlayer(client, pos) {
        if (this.disableSpawn) return; // not allowed to spawn
        // get spawn pos
        var spawnPos = pos ? pos : this.mode.getSpawnPos(this);
        // get spawn size
        var size = this.config.playerStartSize;
        if (this.config.playerStartMass) {
            size = Math.sqrt(this.config.playerStartMass * 100);
        }
        // Create player cell
        var cell = new Entity.PlayerCell(this, client, spawnPos, size);
        this.addNode(cell);
        // Set initial mouse coords
        client.mouse = new Vec2(spawnPos.x, spawnPos.y);
    }
    canEjectMass(client) {
        if (client.lastEject === null) {
            client.lastEject = this.ticks;
            return true;
        }
        var dt = this.ticks - client.lastEject;
        if (dt < this.config.ejectCooldown) {
            return false;
        }
        client.lastEject = this.ticks;
        return true;
    }
    canUseVirus(client) {
        if (!this.config.powerupVirus) return false;
        var delay = this.config.powerupVirusDelay * 25;
        if (!client.lastVirusUsed) {
            client.lastVirusUsed = 0;
        }
        if (this.config.powerupVirusEvery) {
            return (this.ticks - client.lastVirusUsed) > delay;
        } else {
            return (this.ticks - (client.lastVirusUsed || 0)) > delay;
        }
    }
    canUseGrowth(client) {
        if (!this.config.powerupGrowth) return false;
        var delay = this.config.powerupGrowthDelay * 25;
        if (!delay) return false; // safety: zero delay is forbidden
        if (!client.lastGrowthUsed) {
            client.lastGrowthUsed = 0;
        }
        if (this.config.powerupGrowthEvery) {
            return (this.ticks - client.lastGrowthUsed) > delay;
        } else {
            return (this.ticks - (client.lastGrowthUsed || 0)) > delay;
        }
    }
    ejectMass(client) {
        if (!this.canEjectMass(client)) return;
        for (var i = 0; i < client.cells.length; i++) {
            var cell = client.cells[i];
            if (!cell)
                continue;
            if (cell._size < this.config.playerMinEjectSize)
                continue;
            var angle = cell.owner.mouse.angle(cell.position);
            if (isNaN(angle)) angle = Math.PI / 2;
            // Remove mass from parent cell
            var newSize = Math.sqrt(cell._size * cell._size - this.config.ejectSizeLoss * this.config.ejectSizeLoss);
            cell.setSize(Math.max(newSize, this.config.playerMinSize));
            // Eject
            var ejected = new Entity.EjectedMass(this, null, cell.position, this.config.ejectSize);
            ejected.color = cell.color;
            ejected.setBoost(this.config.ejectVelocity, angle);
            this.addNode(ejected);
        }
    }
    shootVirus(client) {
        if (!this.canUseVirus(client)) return;
        var cells = client.cells;
        var cell = cells[cells.length - 1];
        if (!cell) return;
        var angle = cell.owner.mouse.angle(cell.position);
        if (isNaN(angle)) angle = Math.PI / 2;
        var virus = new Entity.Virus(this, null, cell.position, this.config.virusMinSize);
        virus.setBoost(this.config.virusVelocity, angle);
        client.lastVirusUsed = this.ticks;
        this.addNode(virus);
    }
    shootGrowthPellet(client) {
        if (!this.canUseGrowth(client)) return;
        var maxAmount = this.config.growthPelletMaxAmount || 3;
        var liveCount = 0;
        for (var i = 0; i < this.nodesGrowthPellets.length; i++) {
            if (this.nodesGrowthPellets[i].owner === client) liveCount++;
        }
        if (liveCount >= maxAmount) return;
        var cells = client.cells;
        var cell = cells[cells.length - 1];
        if (!cell) return;
        var mousePos = client.mouse;
        if (!mousePos) return;
        var pellet = new Entity.GrowthPellet(
            this,
            client,
            new Vec2(mousePos.x, mousePos.y),
            this.config.growthPelletSize || 80
        );
        client.lastGrowthUsed = this.ticks;
        this.addNode(pellet);
    }
    getRandomPosition() {
        return new Vec2(
            Math.floor(this.border.minx + this.border.width  * Math.random()),
            Math.floor(this.border.miny + this.border.height * Math.random())
        );
    }
    getRandomSpawn(size) {
        var pos, unsafe;
        var attempts = 0;
        do {
            pos = this.getRandomPosition();
            unsafe = this.getSafeSpawnPos(size);
            attempts++;
        } while (unsafe && attempts < 10);
        return pos;
    }
    getSafeSpawnPos(size) {
        return false;
    }
    getGrowthPos(client) {
        var minx = this.border.minx;
        var miny = this.border.miny;
        var maxx = this.border.maxx;
        var maxy = this.border.maxy;
        var margin = 200;
        return new Vec2(
            Math.floor(minx + margin + (maxx - minx - 2 * margin) * Math.random()),
            Math.floor(miny + margin + (maxy - miny - 2 * margin) * Math.random())
        );
    }
    loadFiles() {
        var fs = require("fs");
        // Load the IP ban list
        var fileNameIpBan = this.srcFiles + '/ipbanlist.txt';
        if (fs.existsSync(fileNameIpBan)) {
            // Load and input the contents of the ipban file
            this.ipBanList = fs.readFileSync(fileNameIpBan, 'utf8').split(/[\r\n]+/);
        }
        else {
            Logger.warn("Couldn't find IP ban list: " + fileNameIpBan);
        }
        // Load the user list
        var fileNameUser = this.srcFiles + '/userlist.txt';
        if (fs.existsSync(fileNameUser)) {
            var usersRaw = fs.readFileSync(fileNameUser, 'utf8');
            usersRaw = usersRaw.split(/[\r\n]+/);
            for (var i = 0; i < usersRaw.length; ) {
                var userRaw = usersRaw[i++];
                if (userRaw.indexOf('/') == 0 || !userRaw.length)
                    continue;
                userRaw = userRaw.split(';');
                if (userRaw.length < 4)
                    continue;
                this.userList.push({
                    ip: userRaw[0],
                    password: userRaw[1],
                    role: userRaw[2],
                    name: userRaw[3]
                });
            }
        }
        else {
            Logger.warn("Couldn't find user list: " + fileNameUser);
        }
        // Load bad words list
        var fileNameBadWords = this.srcFiles + '/badwords.txt';
        if (fs.existsSync(fileNameBadWords)) {
            var badWordsRaw = fs.readFileSync(fileNameBadWords, 'utf8');
            badWordsRaw = badWordsRaw.split(/[\r\n]+/);
            for (var i = 0; i < badWordsRaw.length; ) {
                var wordRaw = badWordsRaw[i++].trim();
                if (!wordRaw.length)
                    continue;
                this.badWords.push(wordRaw.toLowerCase());
            }
        }
        else {
            Logger.warn("Couldn't find bad words list: " + fileNameBadWords);
        }
    }
    startStatsServer(port) {
        // Create stats server
        this.statsServer = http.createServer();
        this.statsServer.on('request', this.onStatsServerRequest.bind(this));
        this.statsServer.listen(port, this.config.serverBind, this.onStatsServerOpen.bind(this));
    }
    onStatsServerRequest(req, res) {
        // Check request method and path
        if (req.method != 'GET' || req.url != '/') {
            // Bad request, send error code
            res.writeHead(400);
            res.end();
            return;
        }
        // Get server statistics
        var stats = {
            'name': this.config.serverName,
            'players': this.socketCount,
            'limit': this.config.serverMaxConnections,
            'kills': (this.config.serverBots ? this.config.serverBots : 0),
            'bots': (this.config.serverBots ? this.config.serverBots : 0),
            'mass': 0,
            'uptime': Math.round((Date.now() - this.startTime) / 1000 / 60),
            'version': this.version,
            'update': this.updateTimeAvg
        };
        for (var i = 0; i < this.clients.length; i++) {
            if (this.clients[i].playerTracker.cells.length <= 0)
                continue;
            stats['mass'] += Math.round(this.clients[i].playerTracker._score);
        }
        res.writeHead(200);
        res.end(JSON.stringify(stats));
    }
    onStatsServerOpen() {
        Logger.info("Stats server started, on port " + this.config.serverStatsPort);
    }
    pingServerTracker() {
        // Get server information
        var totalPlayers = 0;
        var maxPlayers = Math.min(this.clients.length, 100);
        var s = this.clients.valueOf();
        s.sort(function (a, b) {
            return b.playerTracker._score - a.playerTracker._score;
        });
        var topPlayers = [];
        for (var i = 0; i < maxPlayers && i < 10; i++) {
            if (!s[i].playerTracker.cells.length)
                continue;
            topPlayers.push({
                id: s[i].playerTracker.pID,
                name: s[i].playerTracker._name
            });
        }
        for (var i = 0; i < this.clients.length; i++) {
            if (!this.clients[i].isConnected)
                continue;
            totalPlayers++;
        }
    }
}

module.exports = Server;
