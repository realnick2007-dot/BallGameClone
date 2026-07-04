module.exports = Object.seal({
    // MultiOgarII-Continued configurations file
// Lines starting with semicolons are comments

// [NOTES]
// MultiOgarII-Continued uses cell size instead of cell mass to improve performance!
// In order to get the cell size from mass value, you need to calculate using this formula:
//    size: SQRT( mass * 100 )
//
// For example, to set start mass: 43:
//     size: SQRT( 43 * 100 ): SQRT( 4300 ): 65.57
// Set playerStartSize: 66
//
// Also, you can use the following syntax to specify mass:
//     playerStartSize: massToSize(43)
// It will be automatically converted to 66

// [LOGGING]
// logVerbosity: Console log level (0=NONE// 1=FATAL// 2=ERROR// 3=WARN// 4=INFO// 5=DEBUG)
// logFileVerbosity: File log level
"logVerbosity": 4,
"logFileVerbosity": 5,

// [SERVER]
// serverTimeout: Seconds to keep connection alive for non-responding client
// serverWsModule: WebSocket module: 'ws' or 'uws' (install npm package before using uws)
// serverMaxConnections: Maximum number of connections to the server. (0 for no limit)
// serverPort: Server port which will be used to listen for incoming connections
// serverBind: Server network interface which will be used to listen for incoming connections (0.0.0.0 for all IPv4 interfaces)
// serverTracker: Set to 1 if you want to show your server on the tracker http://ogar.mivabe.nl/master (check that your server port is opened for external connections first!)
// serverGamemode: Gamemodes: 0: FFA, 1: Teams, 2: Experimental, 3: Rainbow
// serverBots: Number of player bots to spawn (Experimental)
// serverViewBase: Base view distance of players. Warning: high values may cause lag! Min value is 1920x1080
// serverMinScale: Minimum viewbox scale for player (low value leads to lag due to large visible area for big cell)
// serverSpectatorScale: Scale (field of view) used for free roam spectators (low value leads to lag, vanilla: 0.4, old vanilla: 0.25)
// serverStatsPort: Port for the stats server. Having a negative number will disable the stats server.
// serverStatsUpdate: Update interval of server stats in seconds
// mobilePhysics: Whether or not the server uses mobile agar.io physics
// badWordFilter: Toggle whether you enable bad word filter (set to 0 to disable)
// serverRestart: Toggle whether you want your server to auto-restart in minutes. (set to 0 to disable)
"serverTimeout": 300,
"serverWsModule": "ws",
"serverMaxConnections": 500,
"serverPort": 8080,
"serverBind": "0.0.0.0",
"serverTracker": 0,
"serverGamemode": 0,
"serverBots": 10,
"serverViewBaseX": 19200,
"serverViewBaseY": 10800,
"serverMinScale": 0.15,
"serverSpectatorScale": 0.4,
"mobilePhysics": 0,
"badWordFilter": 1,
"serverRestart": 0,

// [CLIENT]
// serverMaxLB: Controls the maximum players displayed on the leaderboard.
// serverChat: Allows the usage of server chat. 0: no chat, 1: use chat.
// serverChatAscii: Set to 1 to disable non-ANSI letters in the chat (english only)
// serverName: Server name, for example "My great server"
// serverWelcome1: First server welcome message
// serverWelcome2: Second server welcome message (optional, for info, etc)
// clientBind: Only allow connections to the server from specified client (eg: http://agar.io - http://mywebsite.com - http://more.com) [Use ' - ' to seperate different websites]
"serverMaxLB": 10,
"serverChat": 1,
"serverChatAscii": 1,
"separateChatForTeams": 0,
"serverName": "MultiOgarII-Continued #1",
"serverWelcome1": "Welcome to MultiOgarII-Continued!",
"serverWelcome2": "",
"clientBind": "",

// [ANTI-BOT]
// serverIpLimit: Controls the maximum number of connections from the same IP (0 for no limit)
// serverMinionIgnoreTime: minion detection disable time on server startup [seconds]
// serverMinionThreshold: max connections within serverMinionInterval time period, which will not be marked as minion
// serverMinionInterval: minion detection interval [milliseconds]
// serverScrambleLevel: Toggles scrambling of coordinates. 0: No scrambling, 1: lightweight scrambling. 2: full scrambling (also known as scramble minimap), 3 - high level scrambling (no border)
// playerBotGrow: Cells greater than 625 mass cannot grow from players under 17 mass (set to 1 to disable)
"serverIpLimit": 4,
"serverMinionIgnoreTime": 30,
"serverMinionThreshold": 10,
"serverMinionInterval": 1000,
"serverScrambleLevel": 0,
"playerBotGrow": 0,

// [POWERUP]
// powerupRecombine: enable recombine powerup on the server
// powerupRecombineDelay: limit in seconds of using recombine powerup
// powerupRecombineEvery: include failed tries of using recombine when counting limit (helps preventing multidropping in case of viruses)
// powerupVirus*: the same as with recombine powerup
// powerupGrowth: enable growth pellet powerup (key bound to opcode 28 — spawns a physical GrowthPellet entity at cursor)
// powerupGrowthDelay: seconds between each growth pellet spawn.
//   IMPORTANT: do NOT set this to 0. A zero delay means canUseGrowth() is always
//   true, allowing the player to spawn a pellet every tick (25/sec). This floods
//   the eatCollisions queue with stacked pellets, causing quadTree.remove(null)
//   to throw and kill the WebSocket process with a 1006 error.
//   Minimum safe value mirrors powerupVirusDelay (0.1). Default: 0.5s.
// powerupGrowthEvery: count failed spawn attempts toward the delay timer
// growthPelletSize: radius of the spawned pellet (clients see it as a large food dot)
// growthPelletMassBoost: mass added to the eating cell when the pellet is consumed
// growthPelletLifeTime: seconds before the pellet auto-expires (0 = never expires)
// growthPelletMaxAmount: maximum number of live pellets a single player can have at once.
//   Mirrors virusMaxAmount for viruses. Prevents stacking via rapid-fire even if
//   powerupGrowthDelay is later lowered. Recommended: 3.
"powerupRecombine": true,
"powerupRecombineDelay": 0,
"powerupRecombineEvery": false,
"recombineBoostSpeed": 75,
"powerupVirus": true,
"powerupVirusDelay": 0.1,
"powerupVirusEvery": true,
"powerupGrowth": true,
"powerupGrowthDelay": 0.1,
"powerupGrowthEvery": false,
"growthPelletSize": 80,
"growthPelletMassBoost": 150000,
"growthPelletLifeTime": 10,
"growthPelletMaxAmount": 50,

// [BORDER]
// Border size (vanilla 14142.135623730952)
"borderWidth": 14142.135623730952*1.5,
"borderHeight": 14142.135623730952*1.5,

// [FOOD]
// foodMinSize: vanilla 10 (mass: 10*10/100: 1 mass)
// foodMaxSize: vanilla 20 (mass: 20*20/100: 4 mass)
// foodAmount: The number of food to spawn
// foodMassGrow: Enable food mass grow ?
"foodMinSize": 10,
"foodMaxSize": 20,
"foodAmount": 700 * 5,
"foodMassGrow": 1,

// [COINS]
// coinAmount: Number of coins to keep alive on the map at all times.
// coinSize: Radius of each coin (visual size on the client).
// coinCurrencyValue: Amount of currency awarded to the player who picks up a coin.
"coinAmount": 50,
"coinSize": 30,
"coinCurrencyValue": 10,

// [VIRUSES]
// virusMinSize: Minimum virus size. (vanilla: mass: val*val/100: 100 mass)
// virusMaxSize: Maximum virus size (vanilla: mass: val*val/100: 200 mass)
// virusMaxPoppedSize: Maximum size a popped cell can have
// virusEqualPopSize: Whether popped cells have equal size or not (1 to enable)
// virusAmount: Amount of viruses to spawn
// virusMaxAmount": Maximum amount of viruses allowed ingame.
// motherCellMaxMass: Maximum amount of mass a mothercell is allowed to have (0 for no limit)
// virusVelocity: Velocity of moving viruses (speed and distance)
// virusMaxCells: Maximum cells a player is allowed to have from virus splits (0 for playerMaxCells)
// virusLifeTime: if not 0, virus life time in seconds
"virusMinSize": 100,
"virusMaxSize": 141.421356237,
"virusMaxPoppedSize": 60,
"virusEqualPopSize": 1,
"virusAmount": 0,//50,
"virusMaxAmount": 100,//100,
"motherCellMaxMass": 0,
"virusVelocity": 780,
"virusMaxCells": 0,
"virusLifeTime": 5,

// [EJECTED MASS]
// ejectSize: vanilla: mass: val*val/100: 13 mass?
// ejectSizeLoss: Eject size which will be substracted from player cell (vanilla: mass: val*val/100: 18 mass?)
// ejectCooldown: Tick count until a player can eject mass again in ticks (1 tick: 40 ms)
// ejectSpawnPercent: Chance for a player to spawn from ejected mass. 0.5: 50% (set to 0 to disable)
// ejectVirus: Whether or not players can eject viruses instead of mass
// ejectVelocity: Velocity of ejecting cells (speed and distance)
"ejectSize": 36.06,
"ejectSizeLoss": 42.43,
"ejectCooldown": 3,
"ejectSpawnPercent": 0.5,
"ejectVirus": 0,
"ejectVelocity": 780,

// [PLAYERS]
// Reminder: MultiOgarII-Continued uses cell size instead of mass!
//       playerStartMass replaced with playerStartSize
//
// playerMinSize: Minimum size a player cell can decay too. (vanilla: val*val/100: 10 mass)
// playerMaxSize: Maximum size a player cell can have before auto-splitting. (vanilla: mass: val*val/100: 22500 mass)
// playerMinSplitSize: Mimimum size a player cell has to be to split. (vanilla: mass: val*val/100: 35 mass)
// playerMinEjectSize: Minimum size a player cell has to be to eject mass. (vanilla: mass: val*val/100: 35 mass)
// playerStartSize: Start size of the player cell. (vanilla: mass: val*val/100: 10 mass)
// playerMaxCells: Maximum cells a player is allowed to have. (vanilla is 16)
// playerSpeed: Player speed multiplier (1: normal speed, 2: twice the normal speed)
// playerRecombineTime: Base time in seconds before a cell is allowed to recombine (vanilla: 30 seconds)
// playerDecayRate: Amount of player cell size lost per second
// playerDecayCap: Maximum mass a cell can have before it's decayrate multiplies by 10. (0 to disable)
// playerDisconnectTime: Time in seconds before a disconnected player's cell is removed from the server (Set to -1 to never remove)
// splitVelocity: Velocity of splitting playercells (speed and distance)
//   NOTE: lowered from 1024 to 250 so split cells settle into a resting line
//   near each other, which is required for Newton's cradle wave chaining.
//   At 1024 cells fly too far apart for resolveRigidCollision impulse to chain.
//
// [SPLIT BLOOM]
// splitGraceTime: Ticks after a split where sibling collision is fully ignored (phase-through). 1 tick = 40ms. (vanilla-style: 13)
// splitBloomTime: Ticks after grace period during which collision force ramps from 0 to full using a cubic curve.
//                 e.g. 13 grace + 26 bloom = ~1.5 seconds total before full separation force.
//                 Set splitBloomTime to 0 to disable bloom (hard collision after grace like vanilla).
"playerMinSize": 31.6227766017,
"playerMaxSize": 3162,
"playerAutosplitCells": 1,
"playerMinSplitSize": 59.16079783,
"playerMinEjectSize": 59.16079783,
"playerStartSize": 707,
"playerMaxCells": 64,
"playerSpeed": 1,
"playerDecayRate": 0.002,
"playerDecayCap": 0,
"playerRecombineTime": 30,
"playerMaxNickLength": 15,
"playerDisconnectTime": -1,
"splitVelocity": 250,
"splitGraceTime": 8,
"splitBloomTime": 8,

// [WAVE PHYSICS]
// cellFriction: Velocity multiplier applied to each player cell every tick.
//   1.0 = no friction (cells coast forever), 0.0 = instant stop.
//   0.82 gives a natural ~5-tick coast — enough for a visible wave without infinite sliding.
// cellRestitution: Bounciness coefficient on rigid cell-cell collision (impulse transfer).
//   0.0 = perfectly inelastic (cells absorb all momentum on impact, no wave).
//   1.0 = perfectly elastic (full Newton's cradle bounce, very chaotic).
//   0.8 gives strong visible chaining through a line of cells (linesplit wave).
//   Previously 0.35 — too low to feel through 4+ cells with friction applied.
// cellVelScale: Fraction of each tick's mouse-step displacement that feeds into
//   the persistent velocity vector. 1.0 = full contribution. 0.6 = tighter steering.
//   Lower values make the cell feel more "planted"; higher values increase wave amplitude.
// axisSnapThreshold: When the travel direction is within this many radians of a
//   cardinal axis (left/right/up/down), the wave impulse is snapped fully onto
//   that axis. This is what enables clean horizontal linesplits — the momentum
//   aligns precisely along the line of cells rather than leaking diagonally.
//   0.08 rad ≈ 4.6 degrees of tolerance on either side of the axis.
"cellFriction": 0.82,
"cellRestitution": 0.8,
"cellVelScale": 0.8,
"axisSnapThreshold": 0.08,

// [MINIONS]
// Custom minion settings
// minionStartSize: Start size of minions (mass: val*val/100: 10 mass)
// minionMaxStartSize: Maximum value of random start size for minions (set value higher than minionStartSize to enable)
// minionCollideTeam: Determines whether minions colide with their team in the Teams gamemode (0: OFF, 1: ON)
// disableERTP: Whether or not to disable ERTP controls for minions. (must use ERTPcontrol script in /scripts) (Set to 0 to enable)
// disableQ: Whether or not to disable Q controls for minions. (Set 0 to enable)
// serverMinions: Amount of minions each player gets once they spawn
// defaultName: Default name for all minions if name is not specified using command (put <r> before the name for random skins!)
// minionsOnLeaderboard: Whether or not to show minions on the leaderboard. (Set 0 to disable)
"minionStartSize": 31.6227766017,
"minionMaxStartSize": 31.6227766017,
"minionCollideTeam": 0,
"disableERTP": 1,
"disableQ": 0,
"serverMinions": 0,
"defaultName": "minion",
"minionsOnLeaderboard": 0,

// [WAVE PHYSICS EXTRA]
// waveBias: 0 = vanilla normal-based push, 1 = full travel-axis push.
"waveBias": 0.6,

// [Gamemode]
// Custom gamemode settings
// tourneyTimeLimit: Time limit of the game, in minutes.
// tourneyAutoFill: If set to a value higher than 0, the tournament match will automatically fill up with bots after value seconds
// tourneyAutoFillPlayers: The timer for filling the server with bots will not count down unless there is this amount of real players
// tourneyLeaderboardToggle Time for toggling the leaderboard, in seconds. If value set to 0, leaderboard will not toggle.
"tourneyMaxPlayers": 12,
"tourneyPrepTime": 10,
"tourneyEndTime": 30,
"tourneyTimeLimit": 20,
"tourneyAutoFill": 0,
"tourneyAutoFillPlayers": 1,
"tourneyLeaderboardToggleTime": 0

})
