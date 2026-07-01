/**
 * CrashLogger.js
 * ---------------
 * Catches every unhandled exception and unhandled Promise rejection that would
 * otherwise silently kill the Node process (or produce the cryptic WebSocket
 * 1006 disconnect you see during local testing).
 *
 * What gets written to crash.log:
 *   - Timestamp of the crash
 *   - Error type (uncaughtException vs unhandledRejection)
 *   - Error message
 *   - Full stack trace
 *   - A snapshot of basic server state if a server instance is attached
 *     (tick count, live node counts, live pellet count) — enough context to
 *     pinpoint whether the crash happened during a growth pellet eat, virus
 *     collision, expiry loop, etc.
 *
 * Usage in index.js:
 *   const CrashLogger = require('./modules/CrashLogger');
 *   CrashLogger.init();                     // registers global handlers
 *   CrashLogger.attachServer(instance);     // optional but recommended
 *
 * The log file location is: server/MultiOgarII/src/logs/crash.log
 * Each run APPENDS to crash.log (old crashes are kept).
 * A separator line is written at startup so you can tell runs apart.
 */

var fs   = require('fs');
var path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
var LOG_DIR  = path.join(__dirname, '..', 'logs');
var LOG_FILE = path.join(LOG_DIR, 'crash.log');

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------
var _server   = null;   // optional Server instance for state snapshots
var _started  = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function timestamp() {
    return new Date().toISOString();
}

function ensureLogDir() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch (e) {
        // If we can't make the directory we fall back to stderr only.
    }
}

/**
 * Writes a line to crash.log synchronously.
 * Synchronous is intentional — at crash time the event loop may be dying and
 * async writes would be lost.
 */
function writeSync(line) {
    try {
        ensureLogDir();
        fs.appendFileSync(LOG_FILE, line + '\n');
    } catch (e) {
        // Last-ditch: at least print to stderr if the file write fails
        process.stderr.write('[CrashLogger] Could not write to crash.log: ' + e.message + '\n');
    }
}

/**
 * Builds a short server-state snapshot string.
 * Safe to call even if _server is partially initialised or mid-crash.
 */
function serverSnapshot() {
    if (!_server) return '  server: (no instance attached)';
    try {
        var lines = [
            '  server.ticks              : ' + (_server.ticks || 0),
            '  server.nodes.length       : ' + ((_server.nodes  || []).length),
            '  server.nodesPlayer.length : ' + ((_server.nodesPlayer  || []).length),
            '  server.nodesVirus.length  : ' + ((_server.nodesVirus   || []).length),
            '  server.nodesFood.length   : ' + ((_server.nodesFood    || []).length),
            '  nodesGrowthPellets.length : ' + ((_server.nodesGrowthPellets || []).length),
            '  server.clients.length     : ' + ((_server.clients || []).length),
        ];
        return lines.join('\n');
    } catch (e) {
        return '  server: (snapshot failed: ' + e.message + ')';
    }
}

/**
 * Core crash-write function. Called from both uncaughtException and
 * unhandledRejection handlers.
 */
function logCrash(type, err) {
    var ts    = timestamp();
    var msg   = (err && err.message) ? err.message : String(err);
    var stack = (err && err.stack)   ? err.stack   : '(no stack trace available)';

    var block = [
        '',
        '════════════════════════════════════════════════════════════',
        'CRASH  [' + ts + ']',
        'Type   : ' + type,
        'Message: ' + msg,
        '────────────────────────────────────────────────────────────',
        'Stack trace:',
        stack,
        '────────────────────────────────────────────────────────────',
        'Server state at time of crash:',
        serverSnapshot(),
        '════════════════════════════════════════════════════════════',
        '',
    ].join('\n');

    // Write to file first (most important — terminal may close)
    writeSync(block);

    // Also print to stderr so it shows up in the local terminal
    process.stderr.write(block + '\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * init() — call once at startup (before server.start()).
 * Registers the global Node.js crash handlers and writes a session-start
 * marker to crash.log so you can tell runs apart when tailing the file.
 */
function init() {
    if (_started) return;
    _started = true;

    ensureLogDir();
    writeSync('\n=== SERVER START ' + timestamp() + ' ===');

    // Unhandled synchronous exceptions (e.g. quadTree.remove(null) throw)
    process.on('uncaughtException', function(err) {
        logCrash('uncaughtException', err);
        // Give the write a moment to flush then exit with non-zero code
        // so you can see the process died in your terminal.
        process.exit(1);
    });

    // Unhandled Promise rejections (async code paths)
    process.on('unhandledRejection', function(reason, promise) {
        var err = (reason instanceof Error) ? reason : new Error(String(reason));
        logCrash('unhandledRejection', err);
        // Do NOT exit for rejections — the server can often continue.
        // The log entry is sufficient for local debugging.
    });

    // Clean shutdown marker
    process.on('exit', function(code) {
        writeSync('=== SERVER EXIT  code=' + code + '  ' + timestamp() + ' ===\n');
    });
}

/**
 * attachServer(server) — pass your Server instance after it is created.
 * Enables the state snapshot in crash reports.
 */
function attachServer(server) {
    _server = server;
}

module.exports = { init: init, attachServer: attachServer };
