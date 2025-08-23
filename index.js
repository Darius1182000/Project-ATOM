require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { initializeLavalink } = require("./src/lavalink/lavalinkManager.js");
const { setupEventHandlers } = require("./src/events/eventHandler");
const { handleMessage } = require("./src/commands/messageHandler");
const { validateEnvironment } = require("./src/utils/environment");

// --- Environment Variable Validation ---
const envVars = validateEnvironment();

// --- Discord Client Initialization ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// --- Initialize Lavalink ---
client.manager = initializeLavalink(client, envVars);

// --- Setup Event Handlers ---
setupEventHandlers(client);

// --- Message Handler ---
client.on("messageCreate", handleMessage);

// --- BOT IS READY EVENT ---
client.on("ready", async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}!`);

  try {
    await client.manager.init(client.user);
    console.log("✅ LavalinkManager initialized successfully.");
    
    setTimeout(() => {
      const totalNodes = client.manager.nodeManager.nodes.size;
      const connectedNodes = Array.from(client.manager.nodeManager.nodes.values()).filter(node => node.connected);
      console.log(`📊 Connected Lavalink nodes: ${connectedNodes.length}/${totalNodes}`);
      
      if (connectedNodes.length > 0) {
        console.log("🎵 Music system is ready!");
      } else {
        console.log("⚠️ No Lavalink nodes connected yet. Checking connection...");
        client.manager.nodeManager.nodes.forEach(node => {
          console.log(`🔍 Node ${node.options.host}:${node.options.port} - Connected: ${node.connected}, Alive: ${node.isAlive}`);
        });
      }
    }, 5000);
    
  } catch (err) {
    console.error("❌ LavalinkManager failed to initialize:", err);
  }
});

client.on("raw", (packet) => {
  client.manager.sendRawData(packet);
});

// --- LOGIN ---
client.login(envVars.TOKEN);