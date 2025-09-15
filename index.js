require('dotenv').config();
const {Client, GatewayIntentBits} = require('discord.js');
const {initializeLavalink} = require('./src/lavalink/lavalinkManager.js');
const {setupEventHandlers} = require('./src/events/eventHandler');
const {handleMessage} = require('./src/commands/messageHandler');
const {validateEnvironment} = require('./src/utils/environment');

// --- Environment Variable Validation ---
const envVars = validateEnvironment();

// --- Discord Client Initialization ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- Initialize Lavalink ---
client.manager = initializeLavalink(client, envVars);

// --- Setup Event Handlers ---
setupEventHandlers(client);

// --- Message Handler ---
client.on('messageCreate', handleMessage);

// Small helper
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connectLavalinkWithRetry(manager, {
    maxAttempts = 10,
    initialDelayMs = 5000,
    backoff = 1.5
} = {}) {
    const nodes = manager?.nodeManager?.nodes ?? new Map();

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const connectedNodes = Array.from(nodes.values()).filter((n) => n.connected);
        const totalNodes = nodes.size;

        if (connectedNodes.length > 0) {
            console.log(`🎵 Music system is ready! Connected Lavalink nodes: ${connectedNodes.length}/${totalNodes}`);
            return true;
        }

        console.warn(`⏳ Lavalink connect attempt ${attempt}/${maxAttempts}...`);
        nodes.forEach((node) => {
            if (!node.connected) {
                try {
                    node.connect();
                } catch (e) {
                    console.error(`Node connect error (${node.options.host}:${node.options.port}):`, e?.message || e);
                }
            }
        });

        // Wait with exponential backoff before next check
        const waitMs = Math.round(initialDelayMs * Math.pow(backoff, attempt - 1));
        await sleep(waitMs);
    }

    // Final status log
    const nodesMap = manager?.nodeManager?.nodes ?? new Map();
    const connectedNodes = Array.from(nodesMap.values()).filter((n) => n.connected);
    console.error(`❌ Lavalink nodes failed to connect after ${maxAttempts} attempts (${connectedNodes.length}/${nodesMap.size} connected).`);
    nodesMap.forEach((node) => {
        console.log(
            `🔍 Node ${node.options.host}:${node.options.port} - Connected: ${node.connected}, Alive: ${node.isAlive}`
        );
    });
    return false;
}

// --- BOT IS READY EVENT ---
client.once('ready', async () => {
    console.log(`✅ Bot logged in as ${client.user.tag}!`);

    try {
        await client.manager.init(client.user);
        console.log('✅ LavalinkManager initialized successfully.');

        // Quick initial snapshot
        setTimeout(() => {
            const totalNodes = client.manager?.nodeManager?.nodes?.size ?? 0;
            const nodes = client.manager?.nodeManager?.nodes ?? new Map();
            const connectedNodes = Array.from(nodes.values()).filter((node) => node.connected);
            console.log(`📊 Connected Lavalink nodes: ${connectedNodes.length}/${totalNodes}`);
            if (connectedNodes.length === 0) {
                console.warn('⚠️ No Lavalink nodes connected yet. Kicking off retry loop...');
            }
        }, 1500);

        // Proactive retry loop (complements library-internal retries)
        await connectLavalinkWithRetry(client.manager, {
            maxAttempts: 8,        // tune to your deployment
            initialDelayMs: 4000,  // how long to wait before the first re-check
            backoff: 1.6           // exponential backoff factor
        });
    } catch (err) {
        console.error('❌ LavalinkManager failed to initialize:', err);
    }
});

client.on('raw', (packet) => {
    // Forward only voice-related packets
    if (!client.manager) return;
    const t = packet?.t;
    if (t === 'VOICE_STATE_UPDATE' || t === 'VOICE_SERVER_UPDATE' || t === 'GUILD_CREATE') {
        client.manager.sendRawData(packet);
    }
});

// Graceful shutdown
const shutdown = async (signal) => {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    try {
        if (client.manager) {
            client.manager.nodeManager?.nodes?.forEach((node) => {
                try {
                    node?.destroy?.();
                } catch {
                }
            });
        }
        await client.destroy();
    } catch (e) {
        console.error('Error during shutdown:', e);
    } finally {
        process.exit(0);
    }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => console.error('Unhandled Promise Rejection:', reason));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));

// --- LOGIN ---
client.login(envVars.TOKEN).catch((err) => {
    console.error('❌ Failed to login to Discord:', err);
    process.exit(1);
});
