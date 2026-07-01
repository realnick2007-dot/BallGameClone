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
    // -------------------------------------------------------------------------

    getSplitGraceTime() {
        if (this.config.splitGraceTime !== undefined) return this.config.splitGraceTime;
        return this.config.mobilePhysics ? 1 : 13;
    }

    getSplitBloomTime() {
        return this.config.splitBloomTime !== undefined ? this.config.splitBloomTime : 13;
    }

    isInSplitGrace(cell) {
        return cell.getAge() < this.getSplitGraceTime();
    }

    canOwnedCellsMerge(a, b) {
        if (!a || !b || !a.owner || a.owner !== b.owner) return false;
        if (a.owner.mergeOverride) return true;
        if (this.isInSplitGrace(a) || this.isInSplitGrace(b)) return false;
        return a._canRemerge && b._canRemerge;
    }

    // -------------------------------------------------------------------------

    start() {
        this.timerLoopBind = this.timerLoop.bind(this);
        this.mainLoopBind = this.mainLoop.bind(this);
        var Gamemode = require('./gamemodes');
        this.mode = Gamemode.get(this.config.serverGamemode);
        this.mode.onServerInit(this);
        var bind = this.config.clientBind + "";
        this.clientBind = bind.split(' - ');
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
        if (this.config.serverStatsPort > 0) {
            this.startStatsServer(this.config.serverStatsPort);
        }
    }
    onHttpServerOpen() {
        setTimeout(this.timerLoopBind, 1);
        Logger.info("Game server started, on port " + this.config.serverPort);
        Logger.info("Current game mode is " + this.mode.name);
        if (this.config.serverBots) {
            for (var i = 0; i < this.config.serverBots; i++)
                this.bots.addBot();
            Logger.info("Added " + this.config.serverBots + " player bots");
        }
        this.spawnCells(this.config.virusAmount, this.config.foodAmount);
    }
    addNode(node) {
        var x = node.position.x;
        var y = node.position.y;
        var s = node._size;
        node.quadItem = {
            cell: node,
            bound: new Quad(x - s, y - s, x + s, y + s)
        };
        this.quadTree.insert(node.quadItem);
        this.nodes.push(node);
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
        process.exit(1);
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
        var timeStep = 40;
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
        if (this.ticks > this.config.serverRestart) {
            this.httpServer = null;
            this.wsServer = null;
            this.run = true;
            this.lastNodeId = 1;
            this.lastPlayerId = 1;
            for (var i = 0; i < this.clients.length; i++) {
                var client = this.clients[i];
                client.close();
            };
            this.nodes = [];
            this.nodesVirus = [];
            this.nodesFood = [];
            this.nodesEjected = [];
            this.nodesPlayer = [];
            this.movingNodes = [];
            if (this.config.serverBots) {
                for (var i = 0; i < this.config.serverBots; i++)
                    this.bots.addBot();
                Logger.info("Added " + this.config.serverBots + " player bots");
            };
            this.commands;
            this.ticks = 0;
            this.startTime = Date.now();
            this.setBorder(this.config.borderWidth, this.config.borderHeight);
            this.quadTree = new QuadNode(this.border, 64, 32);
        };
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
            this.nodesPlayer.forEach((cell) => {
                if (cell.isRemoved)
                    return;
                this.quadTree.find(cell.quadItem.bound, function (check) {
                    var m = self.checkCellCollision(cell, check);
                    if (self.checkRigidCollision(m))
                        self.resolveRigidCollision(m);
                    else if (check != cell)
                        eatCollisions.unshift(m);
                });
                this.movePlayer(cell, cell.owner);
                this.boostCell(cell);
                this.autoSplit(cell, cell.owner);
                if (((this.ticks + 3) % 25) === 0)
                    this.updateSizeDecay(cell);
                if (cell.owner.isMinion) {
                    cell.owner.socket.close(1000, "Minion");
                    this.removeNode(cell);
                }
            });
            eatCollisions.forEach((m) => {
                this.resolveCollision(m);
            });
            if (this.config.virusLifeTime) {
                var virusSnapshot = this.nodesVirus.slice();
                virusSnapshot.forEach(virus => {
                    if (virus.isRemoved) return;
                    if (this.ticks >= virus.createdAt + this.config.virusLifeTime * 25)
                        this.removeNode(virus);
                });
            }
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
    // Move a player cell each tick.
    // Wave physics: each tick the mouse-step feeds into a persistent velocity
    // vector (cell.vel) which is decayed by cellFriction every tick. This means
    // cells carry momentum and transfer it through rigid collisions, producing
    // the chain-reaction wave push seen on Cellcraft.io.
    movePlayer(cell, client) {
        if (client.socket.isConnected == false || client.frozen || !client.mouse)
            return;

        // --- Recombine powerup: rush all non-anchor cells toward the anchor ---
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
                ? this.config.recombineBoostSpeed : 150;
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
        // --- End recombine ---

        var d = client.mouse.difference(cell.position);
        var dist = d.dist();
        var move = cell.getSpeed(dist);
        if (!move) {
            // Cell is at rest — still decay velocity so wave dissipates naturally
            if (cell.vel) {
                var friction = this.config.cellFriction !== undefined ? this.config.cellFriction : 0.82;
                cell.vel.x *= friction;
                cell.vel.y *= friction;
            }
            return;
        }

        // --- Wave physics: blend mouse-step into persistent velocity ---
        var velScale  = this.config.cellVelScale  !== undefined ? this.config.cellVelScale  : 0.8;
        var friction  = this.config.cellFriction  !== undefined ? this.config.cellFriction  : 0.82;

        // The raw displacement this tick (the old direct-teleport amount)
        var stepX = d.x * move;
        var stepY = d.y * move;

        if (cell.vel) {
            // Blend step into velocity with 50/50 smoothing, scaled by velScale
            cell.vel.x = cell.vel.x * 0.5 + stepX * velScale;
            cell.vel.y = cell.vel.y * 0.5 + stepY * velScale;

            // Apply velocity to position
            cell.position.x += cell.vel.x;
            cell.position.y += cell.vel.y;

            // Decay for next tick
            cell.vel.x *= friction;
            cell.vel.y *= friction;
        } else {
            // Fallback for non-player cells (no vel field)
            cell.position.add(d.product(move));
        }

        // update remerge
        var time = this.config.playerRecombineTime, base = Math.max(time, cell._size * 0.2) * 25;
        if (!time || client.rec || client.mergeOverride) {
            var nearest_dist = 10 ** 9, nearest_id;
            for (var _cell of client.cells) {
                var dist2 = client.mouse.difference(_cell.position).dist();
                if (dist2 < nearest_dist) {
                    nearest_dist = dist2;
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
        if (this.canOwnedCellsMerge(m.cell, m.check))
            return false;
        return true;
    }
    resolveRigidCollision(m) {
        var cell  = m.cell;
        var check = m.check;
        var p     = m.p;
        var d     = m.d;

        // Skip if perfectly coincident (no separation axis)
        if (d < 1) return;

        var totalSize = cell._size + check._size;
        var overlap   = totalSize - d;
        if (overlap <= 0) return;

        // --- Split bloom: ramp collision force from 0 to full after grace period ---
        var bloomTime = this.getSplitBloomTime();
        var forceFactor = 1;
        if (bloomTime > 0) {
            var graceTime = this.getSplitGraceTime();
            var ageA = cell.getAge()  - graceTime;
            var ageB = check.getAge() - graceTime;
            var bloomAge = Math.min(ageA, ageB);
            if (bloomAge < 0) { forceFactor = 0; }
            else if (bloomAge < bloomTime) {
                var t = bloomAge / bloomTime;
                forceFactor = t * t * t; // cubic ease-in
            }
        }
        if (forceFactor <= 0) return;

        // --- Position correction: push cells apart proportional to their mass ---
        var nx = p.x / d;
        var ny = p.y / d;
        var massA  = cell._size  * cell._size;
        var massB  = check._size * check._size;
        var totalM = massA + massB;
        var pushA  = (overlap * (massB / totalM)) * forceFactor;
        var pushB  = (overlap * (massA / totalM)) * forceFactor;

        cell.position.x  -= nx * pushA;
        cell.position.y  -= ny * pushA;
        check.position.x += nx * pushB;
        check.position.y += ny * pushB;

        this.updateNodeQuad(cell);
        this.updateNodeQuad(check);

        // --- Wave physics: impulse-based velocity transfer ---
        // Transfers momentum along the collision normal so a chain of cells
        // propagates the push as a wave (Newton's cradle / Cellcraft behaviour).
        if (!cell.vel || !check.vel) return;

        var restitution = this.config.cellRestitution !== undefined
            ? this.config.cellRestitution : 0.35;

        // Relative velocity along the collision normal
        var dvx    = check.vel.x - cell.vel.x;
        var dvy    = check.vel.y - cell.vel.y;
        var relVel = dvx * nx + dvy * ny;

        // Only resolve if cells are moving toward each other
        if (relVel > 0) return;

        // Impulse scalar (mass-weighted)
        var j = -(1 + restitution) * relVel / (1 / massA + 1 / massB);

        // Scale impulse by bloom factor so freshly-split cells don't rocket apart
        j *= forceFactor;

        // Apply impulse
        cell.vel.x  -= (j / massA) * nx;
        cell.vel.y  -= (j / massA) * ny;
        check.vel.x += (j / massB) * nx;
        check.vel.y += (j / massB) * ny;
    }
    resolveCollision(m) {
        var cell = m.cell;
        var check = m.check;

        if (cell.isRemoved || check.isRemoved)
            return;

        if (cell._size > check._size) {
            cell = m.check;
            check = m.cell;
        }
        if (cell.isRemoved || check.isRemoved)
            return;

        // --- Growth pellet (type 5): any PlayerCell eats it unconditionally ---
        if (cell.type === 5 || check.type === 5) {
            var pellet = cell.type === 5 ? cell : check;
            var player = cell.type === 5 ? check : cell;
            if (player.type !== 0) return;
            if (pellet.isRemoved) return;
            if (m.d >= player._size + pellet._size) return;
            pellet.onEaten(player);
            player.onEat(pellet);
            this.removeNode(pellet);
            return;
        }

        if (!check.owner)
            return;
        if (m.d >= check._size + cell._size)
            return;
        if (!check.canEat(cell))
            return;
        cell.killer = check;
        check.onEat(cell);
        cell.onEaten(check);
        this.removeNode(cell);
    }
    splitPlayerCell(client, cell, angle, mass) {
        var size = Math.sqrt(mass * 100);
        var size2 = Math.sqrt(cell.radius - size * size);
        if (size2 < this.config.playerMinSize)
            return;
        cell.setSize(size2);
        var newCell = new Entity.PlayerCell(this, client, cell.position, size);
        newCell.setBoost(this.config.splitVelocity * Math.pow(size, 0.0122), angle);
        this.addNode(newCell);
    }
    spawnVirus(parent) {
        var parentPos = {
            x: parent.position.x,
            y: parent.position.y,
        };
        var newVirus = new Entity.Virus(this, null, parentPos, this.config.virusMinSize);
        if (!this.nodesVirus.length || this.nodesVirus.length < this.config.virusMaxAmount) {
            this.addNode(newVirus);
        }
        return newVirus;
    }
    spawnGrowthPellet(position, owner) {
        var cap = this.config.growthPelletMaxAmount || 3;
        var liveCount = 0;
        for (var i = 0; i < this.nodesGrowthPellets.length; i++) {
            var p = this.nodesGrowthPellets[i];
            if (!p.isRemoved && p.spawner === owner) liveCount++;
        }
        if (liveCount >= cap) return null;

        var x = Math.max(this.border.minx, Math.min(this.border.minx + this.border.width,  position.x));
        var y = Math.max(this.border.miny, Math.min(this.border.miny + this.border.height, position.y));
        var safePos = new Vec2(x, y);
        var pellet = new Entity.GrowthPellet(this, owner, safePos, this.config.growthPelletSize || 80);
        pellet.spawner = owner;
        this.addNode(pellet);
        return pellet;
    }
    ejectMass(client) {
        for (var i = 0; i < client.cells.length; i++) {
            var cell = client.cells[i];
            if (!cell)
                continue;
            if (cell._size < this.config.playerMinEjectSize)
                continue;
            var loss = this.config.ejectSizeLoss;
            var newSize = Math.sqrt(cell.radius - loss * loss);
            var angle = Math.random() * 6.28; // Random angle
            cell.setSize(newSize);
            var spawnPos = {
                x: cell.position.x + this.config.ejectSize * Math.sin(angle),
                y: cell.position.y + this.config.ejectSize * Math.cos(angle)
            };
            var ejected = new Entity.EjectedMass(this, client, spawnPos, this.config.ejectSize);
            ejected.setBoost(this.config.ejectVelocity, angle);
            this.addNode(ejected);
        }
    }
    splitCells(client) {
        var len = client.cells.length;
        for (var i = 0; i < len; i++) {
            var cell = client.cells[i];
            if (cell._size < this.config.playerMinSplitSize)
                continue;
            if (client.cells.length >= this.config.playerMaxCells)
                break;
            // Get angle
            var x = client.mouse.x - cell.position.x;
            var y = client.mouse.y - cell.position.y;
            var angle = Math.atan2(x, y);
            if (isNaN(angle)) angle = Math.PI / 2;
            this.splitPlayerCell(client, cell, angle, cell._mass / 2);
        }
    }
    spawnCells(virusAmount, foodAmount) {
        for (var i = 0; i < virusAmount; i++) {
            var pos = this.getRandomPosition();
            this.addNode(new Entity.Virus(this, null, pos, this.config.virusMinSize));
        }
        for (var i = 0; i < foodAmount; i++) {
            var pos = this.getRandomPosition();
            var food = new Entity.Food(this, null, pos, this.config.foodMinSize + (Math.random() * (this.config.foodMaxSize - this.config.foodMinSize)) >> 0);
            if (this.config.foodMassGrow) {
                var size = this.config.foodMinSize;
                var maxSize = this.config.foodMaxSize;
                var newSize = Math.random() * (maxSize - size);
                food.setSize(newSize + size);
            }
            this.addNode(food);
        }
    }
    loadFiles() {
        var fs = require("fs");
        // User List
        var fileNameUsers = this.srcFiles + '/src/users.json';
        var fileNameIpBan = this.srcFiles + '/src/ipbanlist.txt';
        var fileNameBadWords = this.srcFiles + '/src/badwords.txt';
        try {
            var usersJson = fs.readFileSync(fileNameUsers, 'utf-8');
            this.userList = JSON.parse(usersJson);
        } catch (e) {
            Logger.warn("Failed to load " + fileNameUsers + ": " + e.message);
        }
        try {
            var txt = fs.readFileSync(fileNameIpBan, 'utf-8');
            this.ipBanList = txt.split('\n').map(s => s.trim()).filter(s => s.length);
        } catch (e) {
            Logger.warn("Failed to load " + fileNameIpBan + ": " + e.message);
        }
        try {
            var txt = fs.readFileSync(fileNameBadWords, 'utf-8');
            this.badWords = txt.split('\n').map(s => ' ' + s.trim().toLowerCase() + ' ').filter(s => s.length > 2);
        } catch (e) {
            Logger.warn("Failed to load " + fileNameBadWords + ": " + e.message);
        }
    }
    startStatsServer(port) {
        var http2 = require('http');
        var self = this;
        var statsServer = http2.createServer(function (req, res) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.writeHead(200);
            res.end(JSON.stringify({
                'current_players': self.clients.length,
                'max_players': self.config.serverMaxConnections,
                'server_version': self.version,
            }));
        });
        statsServer.listen(port, function () {
            Logger.info("Stats server listening on port " + port);
        });
    }
    pingServerTracker() {
        // No-op stub — tracker ping removed
    }
    getRandomPosition() {
        return new Vec2(
            this.border.minx + (Math.random() * this.border.width),
            this.border.miny + (Math.random() * this.border.height)
        );
    }
    generateNetworkId() {
        return ++this.lastPlayerId;
    }
}

module.exports = Server;
