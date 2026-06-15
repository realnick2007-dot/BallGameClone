// Library imports
var http = require('http');

// Project imports
var Entity = require('./entity/indexEntity');
var Vec2 = require('./modules/Vec2');
var Logger = require('./modules/Logger');
var {QuadNode, Quad} = require('./modules/QuadNode.js');
const { callbackify } = require('util');

class Server {
    constructor() {
        // Startup
        this.run = true;
        this.version = '1.7.0';
        this.httpServer = null;
        this.lastNodeId = 1;
        this.lastPlayerId = 1;
        this.clients = [];
        this.spectatorsCount = 0;
        this.largestClient = null; // Stores the client with the most cells
        this.nodes = []; // Total nodes
        this.nodesVirus = []; // Virus nodes
        this.nodesFood = []; // Food nodes
        this.nodesEjected = []; // Ejected mass nodes
        this.nodesPlayer = []; // Player nodes
        this.nodesGrowthPellets = []; // Growth pellet nodes
        this.movingNodes = []; // Nodes that are moving (ejected mass, etc)
        this.leaderboard = [];
        this.leaderboardType = -1; // 0 = ffa, 1 = teams, 2 = name
        var config = this.config = require('./config');
        var Logger = require('./modules/Logger');
        Logger.setVerbosity(config.logVerbosity);
        Logger.setFileVerbosity(config.logFileVerbosity);
        // Gamemode
        var Gamemode = require('./gamemodes');
        this.mode = Gamemode.get(config.serverGamemode);
        // Pathfinding
        this.border = new Quad(
            config.borderWidth / -2,
            config.borderHeight / -2,
            config.borderWidth / 2,
            config.borderHeight / 2
        );
        var quadSize = Math.max(config.borderWidth, config.borderHeight);
        this.quadTree = new QuadNode(new Quad(0, 0, quadSize, quadSize), 4, 6);
        this.tickCounter = 0;
        this.ticks = 0;
        this.stepDateTime = 0;
        this.timeoutHandle = 0;
        this.startTime = new Date();
        this.collidingNodes = [];
    }
    start() {
        // Logging
        var Logger = require('./modules/Logger');
        Logger.info('Starting MultiOgarII-Continued ' + this.version);
        // Setup WebSocket
        this.WebSocket = require(this.config.serverWsModule);
        this.httpServer = http.createServer();
        var wsOptions = {
            server: this.httpServer,
            perMessageDeflate: false,
            maxPayload: 4096
        };
        Logger.info('WebSocket: ' + this.config.serverWsModule);
        this.wsServer = new this.WebSocket.Server(wsOptions);
        this.wsServer.on('connection', this.onClientConnect.bind(this));
        this.wsServer.on('error', this.onServerSocketError.bind(this));
        var ServerStat = require('./ServerStat');
        this.statServer = new ServerStat(this);
        this.mode.onServerInit(this);
        // Start stats
        this.statServer.start(this);
        // Player bots
        var BotLoader = require('./ai/BotLoader');
        this.bots = new BotLoader(this);
        // Start server
        this.httpServer.listen(this.config.serverPort, this.config.serverBind, this.onHttpServerOpen.bind(this));
        // Game loop
        this.tickInterval = setInterval(this.tick.bind(this), 40);
    }
    onHttpServerOpen() {
        var Logger = require('./modules/Logger');
        Logger.info('Listening on port ' + this.config.serverPort);
        Logger.info('Current game mode is ' + this.mode.name);
        // Start Main Loop
        if (this.config.serverBots > 0) {
            this.bots.addBots(this.config.serverBots);
            Logger.info('Added ' + this.config.serverBots + ' player bots.');
        }
        this.startTime = new Date();
        this.updateLeaderboard();
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
        Logger.error('WebSocket: ' + error.code + ' - ' + error.message);
        switch (error.code) {
            case 'EADDRINUSE':
                Logger.error('Server could not bind to port ' + this.config.serverPort + '!');
                Logger.error("Please close out of Skype or change 'serverPort' in the config to a different number.");
                break;
            case 'EACCES':
                Logger.error('Permission denied to listen on port ' + this.config.serverPort);
                Logger.error("Use a port above 1024 or use 'sudo' to run.");
                break;
        }
        process.exit(1);
    }
    onClientConnect(ws) {
        // Reject if too many connections
        if (this.config.serverMaxConnections && this.clients.length >= this.config.serverMaxConnections) {
            ws.close(1000, 'No slots available');
            return;
        }
        ws.isConnected = true;
        ws.lastAliveTime = new Date();
        ws.closeTime = 0;
        var PlayerTracker = require('./PlayerTracker');
        ws.playerTracker = new PlayerTracker(this, ws);
        var PacketHandler = require('./PacketHandler');
        ws.packetHandler = new PacketHandler(this, ws);
        var self = this;
        ws.on('message', function (message) {
            if (self.config.serverWsModule === 'ws') {
                // ws@8+: message is a Buffer directly
                if (!Buffer.isBuffer(message)) {
                    if (message instanceof ArrayBuffer) message = Buffer.from(message);
                    else if (Array.isArray(message)) message = Buffer.concat(message);
                    else return;
                }
                ws.packetHandler.handleMessage(message);
            } else {
                ws.packetHandler.handleMessage(message);
            }
        });
        ws.on('error', function (err) {
            ws.packetHandler.sendPacket = function() {};
        });
        ws.on('close', function (reason) {
            if (ws.closeTime === 0)
                ws.closeTime = +new Date();
            ws.isConnected = false;
        });
        this.clients.push(ws);
    }
    tick() {
        this.stepDateTime = +new Date();
        this.ticks++;
        if (!this.run)
            return;
        // Update clients
        var len = this.clients.length;
        for (var i = 0; i < len; i++) {
            this.clients[i].playerTracker.updateTick();
        }
        this.updateMoveEngine();
        this.updateCells();
        // Decay checks
        this.checkDecay();
        this.updateClients();
        // Leaderboard update
        this.tickCounter++;
        if (this.tickCounter % 25 === 0) {
            this.updateLeaderboard();
        }
        // Remove disconnected clients
        var removedClients = [];
        for (var i = 0; i < this.clients.length; i++) {
            var client = this.clients[i].playerTracker;
            client.checkConnection();
            if (client.isRemoved)
                removedClients.push(this.clients[i]);
        }
        for (var i = 0; i < removedClients.length; i++) {
            var index = this.clients.indexOf(removedClients[i]);
            if (index != -1)
                this.clients.splice(index, 1);
        }
    }
    updateMoveEngine() {
        // Update moving nodes
        var eaten = [];
        for (var i = 0; i < this.movingNodes.length; ) {
            var cell = this.movingNodes[i];
            if (cell.isRemoved) {
                this.movingNodes.splice(i, 1);
                continue;
            }
            this.updateNodeQuad(cell);
            if (cell.boostDistance <= 0) {
                cell.isMoving = false;
                this.movingNodes.splice(i, 1);
                continue;
            }
            // Move cell
            var speed = Math.min(cell.boostDistance, Math.abs(cell.boostDistance) / 5 + 7);
            cell.position.x += cell.boostDirection.x * speed;
            cell.position.y += cell.boostDirection.y * speed;
            cell.boostDistance -= speed;
            cell.checkBorder(this.border);
            this.updateNodeQuad(cell);
            // Collision
            var self = this;
            this.quadTree.find(cell.quadItem.bound, function (check) {
                var m = self.getCollisionDist(cell, check.cell);
                if (m.overlap > 0)
                    eaten.push([check.cell, cell]);
            });
            i++;
        }
        for (var i = 0; i < eaten.length; i++) {
            var cell = eaten[i][0];
            var eater = eaten[i][1];
            if (cell.isRemoved || eater.isRemoved)
                continue;
            if (eater.canEat(cell))
                this.resolveCollision(eater, cell);
        }
    }
    updateCells() {
        if (!this.run) return;
        var eaten = [];
        for (var i = 0; i < this.nodesPlayer.length; ) {
            var cell = this.nodesPlayer[i];
            if (cell.isRemoved) {
                this.nodesPlayer.splice(i, 1);
                continue;
            }
            // Move player cell
            this.movePlayer(cell, cell.owner);
            this.updateNodeQuad(cell);
            // Scan for collisions
            var self = this;
            this.quadTree.find(cell.quadItem.bound, function (check) {
                var m = self.getCollisionDist(cell, check.cell);
                if (m.overlap > 0) {
                    var result = self.checkCell(cell, check.cell);
                    if (result)
                        eaten.push(result);
                }
            });
            i++;
        }
        // Resolve all collisions
        for (var i = 0; i < eaten.length; i++) {
            var c = eaten[i];
            if (c[0].isRemoved || c[1].isRemoved)
                continue;
            this.resolveCollision(c[0], c[1]);
        }
    }
    checkCell(cell, check) {
        // No self-collision
        if (cell === check) return null;
        if (cell.owner === check.owner) {
            // Sibling cell collision
            return this.checkSiblingCollision(cell, check);
        }
        // Can cell eat check?
        if (cell.canEat(check)) {
            if (cell._size > check._size * 1.15)
                return [cell, check];
        }
        // Can check eat cell?
        if (check.canEat(cell)) {
            if (check._size > cell._size * 1.15)
                return [check, cell];
        }
        return null;
    }
    checkSiblingCollision(cell, check) {
        if (!cell.owner || cell.owner !== check.owner) return null;
        var config = this.config;
        var age1 = cell.getAge();
        var age2 = check.getAge();
        var minAge = Math.min(age1, age2);
        var grace = config.splitGraceTime || 0;
        var bloom = config.splitBloomTime || 0;
        // Grace period: full phase-through
        if (minAge < grace) return null;
        // Bloom period: ramp from 0 to full collision force
        if (minAge < grace + bloom) {
            var t = (minAge - grace) / bloom;
            var force = t * t * t; // cubic ease-in
            if (force < 0.01) return null;
        }
        // Recombine check
        if (cell.owner.mergeOverride) return [cell, check];
        var rTime = config.playerRecombineTime || 30;
        if (age1 >= rTime * 25 && age2 >= rTime * 25)
            return [cell, check];
        return null;
    }
    resolveCollision(eater, prey) {
        // Remove prey from world
        prey.killer = eater;
        this.removeNode(prey);
        // Grow eater
        eater.onEat(prey);
        prey.onEaten(eater);
        // Update quad position for eater
        this.updateNodeQuad(eater);
    }
    removeNode(node) {
        node.isRemoved = true;
        this.quadTree.remove(node.quadItem);
        var index = this.nodes.indexOf(node);
        if (index != -1)
            this.nodes.splice(index, 1);
        node.onRemove(this);
    }
    updateNodeQuad(node) {
        var s = node._size;
        var x = node.position.x;
        var y = node.position.y;
        node.quadItem.bound.minx = x - s;
        node.quadItem.bound.miny = y - s;
        node.quadItem.bound.maxx = x + s;
        node.quadItem.bound.maxy = y + s;
        this.quadTree.update(node.quadItem);
    }
    updateClients() {
        var len = this.clients.length;
        for (var i = 0; i < len; i++) {
            if (this.clients[i].playerTracker)
                this.clients[i].playerTracker.sendUpdate();
        }
    }
    updateLeaderboard() {
        this.leaderboard = [];
        this.leaderboardType = -1;
        this.mode.updateLB(this, this.leaderboard);
    }
    checkDecay() {
        for (var i = 0; i < this.nodesPlayer.length; i++) {
            var cell = this.nodesPlayer[i];
            if (cell.isRemoved) continue;
            var config = this.config;
            var rate = config.playerDecayRate;
            if (!rate) continue;
            var cap = config.playerDecayCap;
            var decay = 1 - rate / 25;
            if (cap && cell._mass > cap) decay = 1 - (rate * 10) / 25;
            var newSize = Math.sqrt(cell.radius * decay);
            if (newSize < config.playerMinSize) newSize = config.playerMinSize;
            cell.setSize(newSize);
        }
    }
    movePlayer(cell, client) {
        if (!client || client.frozen || !client.mouse) return;
        var dx = client.mouse.x - cell.position.x;
        var dy = client.mouse.y - cell.position.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return;
        var config = this.config;
        var speed = (client.customspeed || config.playerSpeed) * 2.2 * Math.pow(cell._size, -0.4396);
        if (speed > dist) speed = dist;
        if (client.frozen) return;
        cell.position.x += dx / dist * speed;
        cell.position.y += dy / dist * speed;
        cell.checkBorder(this.border);
    }
    getCollisionDist(cell, check) {
        var dx = cell.position.x - check.position.x;
        var dy = cell.position.y - check.position.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var minDist = cell._size + check._size;
        return { dist: dist, overlap: minDist - dist };
    }
    randomPos() {
        return new Vec2(
            this.border.minx + this.border.width * Math.random(),
            this.border.miny + this.border.height * Math.random()
        );
    }
    spawnFood() {
        if (this.nodesFood.length >= this.config.foodAmount) return;
        var cell = new Entity.Food(this, null, this.randomPos(), this.config.foodMinSize);
        this.addNode(cell);
    }
    spawnVirus(position, forced) {
        var position = position || this.randomPos();
        var virus = new Entity.Virus(this, null, position, this.config.virusMinSize, forced);
        this.addNode(virus);
        return virus;
    }
    // Spawns a GrowthPellet at the given position (defaults to mouse cursor passed in from PacketHandler).
    spawnGrowthPellet(position, owner) {
        var position = position || this.randomPos();
        var pellet = new Entity.GrowthPellet(this, owner, position, this.config.growthPelletSize);
        this.addNode(pellet);
        return pellet;
    }
    shootVirus(parent, angle) {
        var pos = parent.position.clone();
        var newVirus = new Entity.Virus(this, null, pos, this.config.virusMinSize);
        newVirus.setBoost(this.config.virusVelocity, angle);
        this.addNode(newVirus);
    }
    onPlayerSpawn(client) {
        if (client.spawnmass && this.config.serverGamemode === 0) {
            var pos = this.randomPos();
            var size = client.spawnmass;
            var cell = new Entity.PlayerCell(this, client, pos, size);
            this.addNode(cell);
            this.nodesPlayer.push(cell);
            return;
        }
        this.mode.onPlayerSpawn(this, client);
    }
    splitCells(client) {
        if (!this.run) return;
        var len = client.cells.length;
        for (var i = 0; i < len; i++) {
            var cell = client.cells[i];
            if (!cell || cell.isRemoved) continue;
            if (cell._size < this.config.playerMinSplitSize) continue;
            if (client.cells.length >= this.config.playerMaxCells) break;
            var angle = Math.atan2(client.mouse.y - cell.position.y, client.mouse.x - cell.position.x);
            if (isNaN(angle)) angle = Math.PI / 2;
            this.splitPlayerCell(client, cell, angle, cell._mass / 2);
        }
    }
    splitPlayerCell(client, cell, angle, mass) {
        var size = Math.sqrt(mass * 100);
        if (size < this.config.playerMinSplitSize) return;
        // Remove size from parent
        var newSize = Math.sqrt(cell.radius - size * size);
        cell.setSize(newSize);
        // Create split cell
        var pos = cell.position.clone();
        var newCell = new Entity.PlayerCell(this, client, pos, size);
        newCell.setBoost(this.config.splitVelocity, angle);
        this.addNode(newCell);
        this.nodesPlayer.push(newCell);
    }
    ejectMass(client) {
        if (!this.run) return;
        for (var i = 0; i < client.cells.length; i++) {
            var cell = client.cells[i];
            if (!cell || cell.isRemoved || cell._size < this.config.playerMinEjectSize) continue;
            var dx = client.mouse.x - cell.position.x;
            var dy = client.mouse.y - cell.position.y;
            var dist = Math.sqrt(dx * dx + dy * dy);
            var angle = dist === 0 ? (2 * Math.PI * Math.random()) : Math.atan2(dy, dx);
            var pos = cell.position.clone();
            // Reduce parent cell
            var newSize = Math.sqrt(cell.radius - this.config.ejectSizeLoss * this.config.ejectSizeLoss);
            if (newSize >= this.config.playerMinSize)
                cell.setSize(newSize);
            var ejected;
            if (this.config.ejectVirus && Math.random() < 0.1) {
                ejected = new Entity.Virus(this, null, pos, this.config.ejectSize);
            } else {
                ejected = new Entity.EjectedMass(this, null, pos, this.config.ejectSize);
            }
            ejected.setBoost(this.config.ejectVelocity, angle);
            this.addNode(ejected);
        }
    }
    sendChatMessage(sender, receiver, message) {
        var Packet = require('./packet');
        for (var i = 0; i < this.clients.length; i++) {
            var client = this.clients[i].playerTracker;
            if (receiver && client !== receiver) continue;
            if (this.clients[i].packetHandler)
                this.clients[i].packetHandler.sendPacket(new Packet.ChatMessage(sender, message));
        }
    }
    checkBadWord(text) {
        if (!this.config.badWordFilter) return false;
        var badWords = [];
        var fs = require('fs');
        if (fs.existsSync('../src/badwords.txt'))
            badWords = fs.readFileSync('../src/badwords.txt', 'utf8').split(/[\r\n]+/).filter(x => x !== '');
        if (!badWords.length) return false;
        var lc = text.toLowerCase();
        for (var i = 0; i < badWords.length; i++) {
            if (lc.indexOf(badWords[i].toLowerCase()) >= 0) return true;
        }
        return false;
    }
    onChatMessage(sender, receiver, text) {
        if (!text) return;
        if (text.length > 128) text = text.slice(0, 128);
        if (this.config.serverChatAscii) {
            for (var i = 0; i < text.length; i++) {
                if (text.charCodeAt(i) < 32 || text.charCodeAt(i) > 126) {
                    this.sendChatMessage(null, sender, 'You can only use ASCII characters in the chat!');
                    return;
                }
            }
        }
        if (this.checkBadWord(text)) {
            this.sendChatMessage(null, sender, 'Please watch your language!');
            return;
        }
        Logger.info('Chat [' + (sender ? sender._name : 'Server') + ']: ' + text);
        this.sendChatMessage(sender, receiver, text);
    }
}

module.exports = Server;
