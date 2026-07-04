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
		this.nodesCoins = []; // Coin nodes
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
        for (var i = 0; i < this.config.coinAmount; i++) {
            this.spawnCoin();
        }
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
		    this.nodesCoins = [];
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
        var dirX = dist > 0 ? d.x / dist : 0;
        var dirY = dist > 0 ? d.y / dist : 0;

        var axisSnapThreshold = this.config.axisSnapThreshold !== undefined ? this.config.axisSnapThreshold : 0.08;
        var absX = Math.abs(dirX);
        var absY = Math.abs(dirY);
        if (absX > absY && absY < axisSnapThreshold) {
            dirX = dirX > 0 ? 1 : -1;
            dirY = 0;
        } else if (absY > absX && absX < axisSnapThreshold) {
            dirX = 0;
            dirY = dirY > 0 ? 1 : -1;
        }

        var isBoosting = cell.isMoving && cell.boostDistance > 1;

        if (cell.vel) {
            var distNorm = Math.min(dist / 2000, 1);
            var blend = 0.5 + distNorm * 0.3;
            cell.vel.x = cell.vel.x * (1 - blend) + (dirX * velScale) * blend;
            cell.vel.y = cell.vel.y * (1 - blend) + (dirY * velScale) * blend;
            if (!isBoosting) {
                var stepX = dirX * move * dist;
                var stepY = dirY * move * dist;
                cell.position.x += stepX;
                cell.position.y += stepY;
            }
            cell.vel.x *= friction;
            cell.vel.y *= friction;
        } else {
            if (!isBoosting) {
                cell.position.add(d.product(move));
            }
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
        if ((m.cell.owner && m.cell.owner.cellsFrozen) ||
            (m.check.owner && m.check.owner.cellsFrozen)) return;

        var cellBoosting  = m.cell.isMoving  && m.cell.boostDistance  > 1;
        var checkBoosting = m.check.isMoving && m.check.boostDistance > 1;

        // FIX: when cells are nearly coincident (born at the same position during
        // a split), m.p is a near-zero vector and m.p/m.d is meaningless as a push
        // direction. In that case, if either cell is boosting, use boostDirection
        // as the push normal directly so cells get pushed along the split axis
        // rather than in a random perpendicular direction.
        if (m.d < 2.0 && (cellBoosting || checkBoosting)) {
            var src = (m.cell.boostDistance >= m.check.boostDistance) ? m.cell : m.check;
            var bx = src.boostDirection.x;
            var by = src.boostDirection.y;
            var blen = Math.sqrt(bx * bx + by * by);
            if (blen > 0) { bx /= blen; by /= blen; }
            // Push cell backward along split axis, check forward
            var overlap = m.cell._size + m.check._size;
            var totalSize = overlap;
            var push = overlap / totalSize * 0.5;
            m.cell.position.x -= bx * push * m.check._size / totalSize;
            m.cell.position.y -= by * push * m.check._size / totalSize;
            m.check.position.x += bx * push * m.cell._size / totalSize;
            m.check.position.y += by * push * m.cell._size / totalSize;
            if (!m.cell.isRemoved && m.cell.quadItem) this.updateNodeQuad(m.cell);
            if (!m.check.isRemoved && m.check.quadItem) this.updateNodeQuad(m.check);
            return;
        }

        if (m.d == 0) return;

        var overlap = m.cell._size + m.check._size - m.d;
        if (overlap <= 0) return;

        var totalSize = m.cell._size + m.check._size;
        var push = overlap / totalSize;

        var bloomScale = 1.0;
        var bloomTime = this.getSplitBloomTime();
        if (bloomTime > 0 && m.cell.owner && m.check.owner && m.cell.owner === m.check.owner) {
            var grace = this.getSplitGraceTime();
            var youngestAge = Math.min(m.cell.getAge(), m.check.getAge());
            var bloomAge = youngestAge - grace;
            if (bloomAge < bloomTime) {
                var t = Math.max(0, bloomAge / bloomTime);
                bloomScale = t * t * t;
            }
        }

        var r1 = push * m.check._size / totalSize * bloomScale;
        var r2 = push * m.cell._size  / totalSize * bloomScale;

        m.cell.position.subtract(m.p.product(r1));
        m.check.position.add(m.p.product(r2));

        if (m.cell.vel && m.check.vel && m.d > 0) {
            var restitution = this.config.cellRestitution !== undefined
                ? this.config.cellRestitution : 0.35;

            var nx = m.p.x / m.d;
            var ny = m.p.y / m.d;

            var travelX, travelY;
            if (cellBoosting || checkBoosting) {
                var src = (m.cell.boostDistance >= m.check.boostDistance) ? m.cell : m.check;
                travelX = src.boostDirection.x;
                travelY = src.boostDirection.y;
            } else {
                travelX = m.cell.vel.x + m.check.vel.x;
                travelY = m.cell.vel.y + m.check.vel.y;
                var avgLen = Math.sqrt(travelX * travelX + travelY * travelY);
                if (avgLen < 1.0) {
                    travelX = 0;
                    travelY = 0;
                } else {
                    travelX /= avgLen;
                    travelY /= avgLen;
                }
            }

            if (travelX !== 0 || travelY !== 0) {
                var axisSnapThreshold = this.config.axisSnapThreshold !== undefined ? this.config.axisSnapThreshold : 0.08;
                var atx = Math.abs(travelX);
                var aty = Math.abs(travelY);
                if (atx > aty && aty < axisSnapThreshold) {
                    travelX = travelX > 0 ? 1 : -1;
                    travelY = 0;
                } else if (aty > atx && atx < axisSnapThreshold) {
                    travelX = 0;
                    travelY = travelY > 0 ? 1 : -1;
                }
                var bias = this.config.waveBias !== undefined ? this.config.waveBias : 0.6;
                nx = nx * (1 - bias) + travelX * bias;
                ny = ny * (1 - bias) + travelY * bias;
                var nlen = Math.sqrt(nx * nx + ny * ny);
                if (nlen > 0) { nx /= nlen; ny /= nlen; }
            }

            var dvx    = m.check.vel.x - m.cell.vel.x;
            var dvy    = m.check.vel.y - m.cell.vel.y;
            var relVel = dvx * nx + dvy * ny;

            if (relVel < 0) {
                var massA = m.cell._size  * m.cell._size;
                var massB = m.check._size * m.check._size;
                var j = -(1 + restitution) * relVel / (1 / massA + 1 / massB) * bloomScale;
                m.cell.vel.x  -= (j / massA) * nx;
                m.cell.vel.y  -= (j / massA) * ny;
                m.check.vel.x += (j / massB) * nx;
                m.check.vel.y += (j / massB) * ny;
            }
        }

        if (!m.cell.isRemoved && m.cell.quadItem)
            this.updateNodeQuad(m.cell);
        if (!m.check.isRemoved && m.check.quadItem)
            this.updateNodeQuad(m.check);
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

        if (cell.type === 5 && check.type === 0) {
            if (m.d < check._size) {
                check.onEat(cell);
                cell.onEaten(check);
                cell.killer = check;
                this.removeNode(cell);
            }
            return;
        }
        if (check.type === 5 && cell.type === 0) {
            if (m.d < cell._size) {
                cell.onEat(check);
                check.onEaten(cell);
                check.killer = cell;
                this.removeNode(check);
            }
            return;
        }

        if (cell.type === 6 && check.type === 0) {
            if (m.d < check._size) {
                cell.onEaten(check);
                cell.killer = check;
                this.removeNode(cell);
            }
            return;
        }
        if (check.type === 6 && cell.type === 0) {
            if (m.d < cell._size) {
                check.onEaten(cell);
                check.killer = cell;
                this.removeNode(check);
            }
            return;
        }

        check.div = this.config.mobilePhysics ? 20 : 3;
        if (m.d >= check._size - cell._size / check.div) {
            return;
        }
        if (cell.owner && cell.owner == check.owner) {
            if (!this.canOwnedCellsMerge(cell, check)) return;
        }
        else if (check._size < cell._size * 1.15 || !check.canEat(cell))
            return;
        check.onEat(cell);
        cell.onEaten(check);
        cell.killer = check;
        this.removeNode(cell);
        if (cell.owner && cell.owner.cells.length <= 1) {
            cell.owner.mergeOverride = false;
        }
    }
    splitPlayerCell(client, parent, angle, mass) {
        var size = Math.sqrt(mass * 100);
        var size1 = Math.sqrt(parent.radius - size * size);
        if (!size1 || size1 < this.config.playerMinSize)
            return;
        parent.setSize(size1);
        var newCell = new Entity.PlayerCell(this, client, parent.position, size);
        newCell.setBoost(this.config.splitVelocity * Math.pow(size, 0.0122), angle);
        this.addNode(newCell);
    }
    randomPos() {
        return new Vec2(this.border.minx + this.border.width * Math.random(),
            this.border.miny + this.border.height * Math.random());
    }
    onField(position) {
        return this.border.minx <= position.x && position.x <= this.border.minx + this.border.width
            && this.border.miny <= position.y && position.y <= this.border.miny + this.border.height;
    }
    spawnFood() {
        var cell = new Entity.Food(this, null, this.randomPos(), this.config.foodMinSize);
        if (this.config.foodMassGrow) {
            var maxGrow = this.config.foodMaxSize - cell._size;
            cell.setSize(cell._size += maxGrow * Math.random());
        }
        cell.color = this.getRandomColor();
        this.addNode(cell);
    }
    spawnCoin() {
        if (this.nodesCoins.length >= this.config.coinAmount) return;
        var coin = new Entity.Coin(this, null, this.randomPos(), this.config.coinSize);
        this.addNode(coin);
    }
    spawnVirus(position = this.randomPos(), forced = false) {
        var virus = new Entity.Virus(this, null, position, this.config.virusMinSize, forced);
        if (!this.onField(position)) return;
        if (forced || !this.willCollide(virus)) {
            this.addNode(virus);
        }
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
        var pellet = new Entity.GrowthPellet(this, owner, safePos, this.config.growthPelletSize);
        this.addNode(pellet);
        return pellet;
    }
    spawnCells(virusCount, foodCount) {
        for (var i = 0; i < foodCount; i++) {
            this.spawnFood();
        }
        for (var ii = 0; ii < virusCount; ii++) {
            this.spawnVirus();
        }
    }
    spawnPlayer(player, pos) {
        if (this.disableSpawn)
            return;
        var size = this.config.playerStartSize;
        if (player.spawnmass)
            size = player.spawnmass;
        var index = ~~(this.nodesEjected.length * Math.random());
        var eject = this.nodesEjected[index];
        if (Math.random() <= this.config.ejectSpawnPercent &&
            eject && eject.boostDistance < 1) {
            pos = eject.position.clone();
            player.color = eject.color;
            size = Math.max(size, eject._size * 1.15);
        }
        var cell = new Entity.PlayerCell(this, player, pos, size);
        if (this.willCollide(cell) && !player.isMi)
            pos = this.randomPos();
        this.addNode(cell);
        player.mouse.assign(pos);
    }
    willCollide(cell) {
        const x = cell.position.x;
        const y = cell.position.y;
        const r = cell._size;
        const bound = new Quad(x - r, y - r, x + r, y + r);
        return this.quadTree.find(bound, n => n.type == 0);
    }
    splitCells(client) {
        // FIX: compute one authoritative split angle from the centroid of ALL
        // player cells to the mouse cursor. Previously each cell computed d from
        // its own position — when cells are stacked on top of each other (mouse
        // held at center during a linesplit) each d was near-zero and the angle
        // defaulted to 0 (right), so every cell fired right regardless of where
        // the player was actually aiming. Using the centroid gives a single stable
        // direction vector even when individual cell positions are nearly coincident.
        var cx = 0, cy = 0;
        for (var i = 0; i < client.cells.length; i++) {
            cx += client.cells[i].position.x;
            cy += client.cells[i].position.y;
        }
        cx /= client.cells.length;
        cy /= client.cells.length;
        var globalD = client.mouse.difference(new Vec2(cx, cy));
        if (globalD.distSquared() < 1) {
            globalD.x = 1;
            globalD.y = 0;
        }
        var splitAngle = globalD.angle();

        var cellToSplit = [];
        for (var i = 0; i < client.cells.length; i++)
            cellToSplit.push(client.cells[i]);

        cellToSplit.forEach((cell) => {
            if (cell._size < this.config.playerMinSplitSize)
                return;
            if (client.rec)
                var max = 200;
            else
                max = this.config.playerMaxCells;
            if (client.cells.length >= max)
                return;
            // All cells fire at the same global split angle — consistent linesplit axis
            this.splitPlayerCell(client, cell, splitAngle, cell._mass * .5);
        });
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
    ejectMass(client) {
        if (!this.canEjectMass(client) || client.cellsFrozen)
            return;
        for (var i = 0; i < client.cells.length; i++) {
            var cell = client.cells[i];
            if (cell._size < this.config.playerMinEjectSize) continue;
            var loss = this.config.ejectSizeLoss;
            var newSize = cell.radius - loss * loss;
            var minSize = this.config.playerMinSize;
            if (newSize < 0 || newSize < minSize * minSize)
                continue;
            cell.setSize(Math.sqrt(newSize));
            var d = client.mouse.difference(cell.position);
            var sq = d.dist();
            d.x = sq > 1 ? d.x / sq : 1;
            d.y = sq > 1 ? d.y / sq : 0;
            var pos = cell.position.sum(d.product(cell._size));
            var angle = d.angle() + (Math.random() * .6) - .3;
            var ejected;
            if (this.config.ejectVirus) {
                ejected = new Entity.Virus(this, null, pos, this.config.ejectSize);
            } else {
                ejected = new Entity.EjectedMass(this, null, pos, this.config.ejectSize);
            }
            ejected.color = cell.color;
            ejected.setBoost(this.config.ejectVelocity, angle);
            this.addNode(ejected);
        }
    }
    shootVirus(parent, angle) {
        var pos = parent.position.clone();
        var newVirus = new Entity.Virus(this, null, pos, this.config.virusMinSize);
        newVirus.setBoost(this.config.virusVelocity, angle);
        this.addNode(newVirus);
    }
    loadFiles() {
        const fs = require("fs");
        var fileNameBadWords = this.srcFiles + '/badwords.txt';
        try {
            if (!fs.existsSync(fileNameBadWords)) {
                Logger.warn(fileNameBadWords + " not found");
            }
            else {
                var words = fs.readFileSync(fileNameBadWords, 'utf-8');
                words = words.split(/[\r\n]+/);
                words = words.map(function (arg) {
                    return " " + arg.trim().toLowerCase() + " ";
                });
                words = words.filter(function (arg) {
                    return arg.length > 2;
                });
                this.badWords = words;
                Logger.info(this.badWords.length + " bad words loaded");
            }
        }
        catch (err) {
            Logger.error(err.stack);
            Logger.error("Failed to load " + fileNameBadWords + ": " + err.message);
        }
        var UserRoleEnum = require(this.srcFiles + '/enum/UserRoleEnum');
        var fileNameUsers = this.srcFiles + '/enum/userRoles.json';
        try {
            this.userList = [];
            if (!fs.existsSync(fileNameUsers)) {
                Logger.warn(fileNameUsers + " is missing.");
                return;
            }
            var usersJson = fs.readFileSync(fileNameUsers, 'utf-8');
            var list = JSON.parse(usersJson.trim());
            for (var i = 0; i < list.length;) {
                var item = list[i];
                if (!item.hasOwnProperty("ip") ||
                    !item.hasOwnProperty("password") ||
                    !item.hasOwnProperty("role") ||
                    !item.hasOwnProperty("name")) {
                    list.splice(i, 1);
                    continue;
                }
                if (!item.password || !item.password.trim()) {
                    Logger.warn("User account \"" + item.name + "\" disabled");
                    list.splice(i, 1);
                    continue;
                }
                if (item.ip)
                    item.ip = item.ip.trim();
                item.password = item.password.trim();
                if (!UserRoleEnum.hasOwnProperty(item.role)) {
                    Logger.warn("Unknown user role: " + item.role);
                    item.role = UserRoleEnum.USER;
                }
                else {
                    item.role = UserRoleEnum[item.role];
                }
                item.name = (item.name || "").trim();
                i++;
            }
            this.userList = list;
            Logger.info(this.userList.length + " user records loaded.");
        }
        catch (err) {
            Logger.error(err.stack);
            Logger.error("Failed to load " + fileNameUsers + ": " + err.message);
        }
        var fileNameIpBan = this.srcFiles + '/ipbanlist.txt';
        try {
            if (fs.existsSync(fileNameIpBan)) {
                this.ipBanList = fs.readFileSync(fileNameIpBan, "utf8").split(/[\r\n]+/).filter(function (x) {
                    return x != '';
                });
                Logger.info(this.ipBanList.length + " IP ban records loaded.");
            }
            else {
                Logger.warn(fileNameIpBan + " is missing.");
            }
        }
        catch (err) {
            Logger.error(err.stack);
            Logger.error("Failed to load " + fileNameIpBan + ": " + err.message);
        }
        this.config.serverRestart = this.config.serverRestart === 0 ? 1e999 : this.config.serverRestart * 1500;
    }
    startStatsServer(port) {
        this.getStats();
        this.httpServer = http.createServer(function (req, res) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.writeHead(200);
            res.end(this.stats);
        }.bind(this));
        this.httpServer.on('error', function (err) {
            Logger.error("Failed to start stats server: " + err.message);
        });
        var getStatsBind = this.getStats.bind(this);
        this.httpServer.listen(port, function () {
            Logger.info("Started stats server on port " + port);
            setInterval(getStatsBind, this.config.serverStatsUpdate * 1000);
        }.bind(this));
    }
    getStats() {
        let alivePlayers = 0;
        let spectatePlayers = 0;
        let bots = 0;
        let minions = 0;
        for (const client of this.clients) {
            if (!client || !client.isConnected) continue;
            if (client.playerTracker.isBot) ++bots;
            else if (client.playerTracker.isMi) ++minions;
            else if (client.playerTracker.cells.length) ++alivePlayers;
            else ++spectatePlayers;
        }
        var s = {
            'server_name': this.config.serverName,
            'server_chat': this.config.serverChat ? "true" : "false",
            'border_width': this.border.width,
            'border_height': this.border.height,
            'gamemode': this.mode.name,
            'max_players': this.config.serverMaxConnections,
            'current_players': alivePlayers + spectatePlayers,
            'alive': alivePlayers,
            'spectators': spectatePlayers,
            'bots': bots,
            'minions': minions,
            'update_time': this.updateTimeAvg.toFixed(3),
            'uptime': Math.round((this.stepDateTime - this.startTime) / 1000 / 60),
            'start_time': this.startTime,
            'stats_time': Date.now()
        };
        this.statsObj = s;
        this.stats = JSON.stringify(s);
    }
    pingServerTracker() {
        var os = require('os');
        var totalPlayers = 0;
        var alivePlayers = 0;
        var spectatePlayers = 0;
        var robotPlayers = 0;
        for (var i = 0, len = this.clients.length; i < len; i++) {
            var socket = this.clients[i];
            if (!socket || socket.isConnected == false)
                continue;
            if (socket.isConnected == null) {
                robotPlayers++;
            }
            else {
                totalPlayers++;
                if (socket.playerTracker.cells.length)
                    alivePlayers++;
                else
                    spectatePlayers++;
            }
        }
        var data = 'current_players=' + totalPlayers +
            '&alive=' + alivePlayers +
            '&spectators=' + spectatePlayers +
            '&max_players=' + this.config.serverMaxConnections +
            '&sport=' + this.config.serverPort +
            '&gamemode=[**] ' + this.mode.name +
            '&agario=true' +
            '&name=Unnamed Server' +
            '&opp=' + os.platform() + ' ' + os.arch() +
            '&uptime=' + process.uptime() +
            '&version=MultiOgarII-Continued ' + this.version +
            '&start_time=' + this.startTime;
        trackerRequest({
            host: 'ogar.mivabe.nl',
            port: 80,
            path: '/master',
            method: 'POST'
        }, 'application/x-www-form-urlencoded', data);
    }
};

function trackerRequest(options, type, body) {
    if (options.headers == null) options.headers = {};
    options.headers['user-agent'] = 'MultiOgarII-Continued' + this.version;
    options.headers['content-type'] = type;
    options.headers['content-length'] = body == null ? 0 : Buffer.byteLength(body, 'utf8');
    var req = http.request(options, function (res) {
        if (res.statusCode != 200) {
            Logger.writeError("[Tracker][" + options.host + "]: statusCode = " + res.statusCode);
            return;
        }
        res.setEncoding('utf8');
    });
    req.on('error', function (err) {
        Logger.writeError("[Tracker][" + options.host + "]: " + err);
    });
    req.shouldKeepAlive = false;
    req.on('close', function () {
        req.destroy();
    });
    req.write(body);
    req.end();
}
module.exports = Server;
