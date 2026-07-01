// External modules.
const ReadLine = require("readline");

// Project modules.
const Commands    = require("./modules/CommandList.js");
const Server      = require("./Server.js");
const Logger      = require("./modules/Logger.js");
const CrashLogger = require("./modules/CrashLogger.js");

// ── Crash logging ────────────────────────────────────────────────────────────
// Must be initialised BEFORE server.start() so that any exception thrown
// during startup is captured. All uncaughtExceptions and unhandledRejections
// are written to:  server/MultiOgarII/src/logs/crash.log
// Each run appends to the file with a timestamp separator, so you can scroll
// back through previous crashes without losing history.
CrashLogger.init();

// Create and start instance of server.
const instance = new Server();
CrashLogger.attachServer(instance);   // enables server-state snapshots in reports
instance.start();

// Welcome message.
Logger.info(`Running MultiOgarII-Continued ${instance.version}, a FOSS agar.io server implementation.`);
Logger.info(`Crash logging active  →  logs/crash.log`);

// Create console interface.
const inputInterface = ReadLine.createInterface(process.stdin, process.stdout);

// First prompt
setTimeout(() => process.stdout.write("> "));

// Catch console input.
inputInterface.on("line", (input) => {
    const args = input.toLowerCase().split(" ");
    if (Commands[args[0]]) {
        Commands[args[0]](instance, args)
    };
    process.stdout.write("> ");
});
