require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { DisTube } = require("distube");
const { YtDlpPlugin } = require("@distube/yt-dlp");

// Using system FFmpeg (no additional setup needed)

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Robust safe message sender
function safeSend(source, message) {
  let textChannel = null;

  // Check different possible locations for text channel
  if (source?.textChannel) textChannel = source.textChannel;
  else if (source?.metadata?.textChannel) textChannel = source.metadata.textChannel;
  else if (typeof source?.send === "function") textChannel = source;
  else if (source?.channel) textChannel = source.channel;

  if (textChannel && typeof textChannel.send === "function") {
    textChannel.send(message).catch(err => {
      console.warn("⚠ Failed to send message:", err.message);
    });
  } else {
    console.warn("⚠ Could not send message — no valid text channel found.");
    console.log("Debug - source object keys:", source ? Object.keys(source) : "source is null");
  }
}

// Create DisTube instance
const distube = new DisTube(client, {
  plugins: [new YtDlpPlugin()],
});

const TOKEN = process.env.DISCORD_TOKEN;

client.on("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}!`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const args = message.content.split(" ");
  const command = args.shift().toLowerCase();

  if (message.content === ".gabriel") {
    message.reply("Gabriel del Mundo do Santos Alveira Pedro Sales Hectorus Las Vegas Official");
  }

  if (command === ".play") {
    console.log("▶️ Play command with args:", args);
    await playMusic(message, args.join(" "));
  }

  if (command === ".stop") {
    const queue = distube.getQueue(message.guild.id);
    if (queue) {
      distube.stop(message.guild.id);
      message.reply("⏹️ Stopped the music!");
    } else {
      message.reply("Nothing is playing right now.");
    }
  }

  if (command === ".skip") {
    const queue = distube.getQueue(message.guild.id);
    if (queue) {
      distube.skip(message.guild.id);
      message.reply("⏭️ Skipped the current song!");
    } else {
      message.reply("Nothing is playing right now.");
    }
  }

  if (command === ".pause") {
    const queue = distube.getQueue(message.guild.id);
    if (queue) {
      if (queue.paused) {
        distube.resume(message.guild.id);
        message.reply("▶️ Resumed the music!");
      } else {
        distube.pause(message.guild.id);
        message.reply("⏸️ Paused the music!");
      }
    } else {
      message.reply("Nothing is playing right now.");
    }
  }

  if (command === ".queue") {
    const queue = distube.getQueue(message.guild.id);
    if (!queue) return message.reply("Nothing is playing right now.");

    const queueList = queue.songs
      .slice(0, 10)
      .map((song, index) =>
        `${index === 0 ? "**Now Playing:**" : `${index}.`} ${song.name} - ${song.formattedDuration}`
      )
      .join("\n");

    message.reply(`**Queue:**\n${queueList}`);
  }
});

client.login(TOKEN);

// Function to play music
async function playMusic(message, query) {
  if (!query) return message.reply("Please provide a YouTube link or search term.");

  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) return message.reply("Join a voice channel first!");

  try {
    console.log("🎶 Attempting to play:", query);

    await distube.play(voiceChannel, query, {
      textChannel: message.channel,
      member: message.member,
      metadata: { textChannel: message.channel },
    });
  } catch (err) {
    console.error("❌ Error in playMusic:", err);
    message.reply("Failed to play audio. Please try a different video or search term.");
  }
}

// DisTube Events
distube.on("playSong", (queue, song) => {
  console.log("✅ Now playing:", song.name);
  if (queue.textChannel) {
    queue.textChannel.send(`🎵 **Now playing:** ${song.name} - \`${song.formattedDuration}\``).catch(console.error);
  }
});

distube.on("addSong", (queue, song) => {
  console.log("✅ Added to queue:", song.name);
  if (queue.textChannel) {
    queue.textChannel.send(`✅ **Added to queue:** ${song.name} - \`${song.formattedDuration}\``).catch(console.error);
  }
});

distube.on("addList", (queue, playlist) => {
  console.log("Added playlist:", playlist.name);
  if (queue.textChannel) {
    queue.textChannel.send(`✅ **Added playlist:** ${playlist.name} (${playlist.songs.length} songs)`).catch(console.error);
  }
});

distube.on("error", (channel, error) => {
  console.error("DisTube error:", error);
  console.error("Error channel/source:", channel);
  
  // Try multiple ways to send error message
  if (channel && typeof channel.send === "function") {
    // channel is a text channel
    channel.send("❌ An error occurred while trying to play the audio.").catch(console.error);
  } else if (channel && channel.textChannel && typeof channel.textChannel.send === "function") {
    // channel is a queue with textChannel
    channel.textChannel.send("❌ An error occurred while trying to play the audio.").catch(console.error);
  } else {
    // Fallback - log only
    console.error("❌ Could not send error message - no valid channel found");
  }
});

distube.on("empty", (queue) => {
  console.log("Voice channel is empty, leaving...");
  if (queue.textChannel) {
    queue.textChannel.send("Voice channel is empty. Leaving the channel...").catch(console.error);
  }
});

distube.on("finish", (queue) => {
  console.log("Queue finished");
  if (queue.textChannel) {
    queue.textChannel.send("🏁 Queue finished! No more songs to play.").catch(console.error);
  }
});

distube.on("disconnect", (queue) => {
  console.log("Disconnected from voice channel");
  if (queue.textChannel) {
    queue.textChannel.send("⏹️ Disconnected from the voice channel!").catch(console.error);
  }
});

// Add debug event to see what's happening
distube.on("initQueue", (queue) => {
  console.log("🔧 Queue initialized for guild:", queue.id);
});

// Additional debugging
distube.on("searchResult", (message, result) => {
  console.log("🔍 Search result:", result.length, "results found");
});

distube.on("searchNoResult", (message, query) => {
  console.log("❌ No search results for:", query);
  message.channel.send(`❌ No results found for: ${query}`).catch(console.error);
});

distube.on("searchCancel", (message, query) => {
  console.log("🚫 Search cancelled for:", query);
});