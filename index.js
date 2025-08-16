require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { DisTube } = require("distube");
const { YtDlpPlugin } = require("@distube/yt-dlp");
const { SpotifyPlugin } = require("@distube/spotify");
const SpotifyWebApi = require('spotify-web-api-node');
const ytSearch = require('yt-search');

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
function sendMessage(source, message) {
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
  plugins: [
    new YtDlpPlugin(),
    new SpotifyPlugin(),
  ],
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
    sendMessage(message, "Gabriel del Mundo do Santos Alveira Pedro Sales Hectorus Las Vegas Official");
  }

  if (command === ".play") {
    console.log("▶️ Play command with args:", args);
    await playMusic(message, args.join(" "));
  }

  if (command === ".stop") {
    const queue = distube.getQueue(message.guild.id);
    if (queue) {
      distube.stop(message.guild.id);
      sendMessage(message, "⏹️ Stopped the music!");
    } else {
      sendMessage(message, "Nothing is playing right now.");
    }
  }

  if (command === ".skip") {
    const queue = distube.getQueue(message.guild.id);
    if (queue) {
      distube.skip(message.guild.id);
      sendMessage(message, "⏭️ Skipped the current song!");
    } else {
      sendMessage(message, "Nothing is playing right now.");
    }
  }

  if (command === ".pause") {
    const queue = distube.getQueue(message.guild.id);
    if (queue) {
      if (queue.paused) {
        distube.resume(message.guild.id);
        sendMessage(message, "▶️ Resumed the music!");
      } else {
        distube.pause(message.guild.id);
        sendMessage(message, "⏸️ Paused the music!");
      }
    } else {
      sendMessage(message, "Nothing is playing right now.");
    }
  }

  if (command === ".queue") {
    const queue = distube.getQueue(message.guild.id);
    if (!queue) return sendMessage(message, "Nothing is playing right now."); 

    const queueList = queue.songs
      .slice(0, 10)
      .map((song, index) =>
        `${index === 0 ? "**Now Playing:**" : `${index}.`} ${song.name} - ${song.formattedDuration}`
      )
      .join("\n");

    sendMessage(message, `**Queue:**\n${queueList}`);
  }

  if (command === ".loop") {
  const queue = distube.getQueue(message.guild.id);
  if (!queue) return sendMessage(message, "Nothing is playing right now.");

  // Toggle repeat mode for current song
  const mode = queue.repeatMode === 1 ? 0 : 1;
  distube.setRepeatMode(message.guild.id, mode);

  sendMessage(
    message,
    mode === 1
      ? "🔁 Loop enabled: The current song will repeat."
      : "⏹️ Loop disabled: The current song will not repeat."
  );
}
});

client.login(TOKEN);

// Function to play music
async function playMusic(message, query) {
  if (!query) return sendMessage(message, "Please provide a YouTube link or search term.");

  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) return sendMessage(message, "Join a voice channel first!");

  try {
    console.log("🎶 Attempting to play:", query);

    await distube.play(voiceChannel, query, {
      textChannel: message.channel,
      member: message.member,
      metadata: { textChannel: message.channel },
      searchSongs: false,
    });
  } catch (err) {
    console.error("❌ Error in playMusic:", err);
    // Fallback: If the query is a Spotify track link, try to fetch metadata and play from YouTube
    if (query.includes("open.spotify.com/track/")) {
      sendMessage(message, "Trying to find this Spotify track on YouTube...");
      await playSpotifyFallback(message, query); // <-- Call your fallback function here
    } else {
      sendMessage(message, "❌ An error occurred while trying to play the audio.");
    }
  }
}

async function playSpotifyFallback(message, spotifyTrackUrl, song) {
    const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET
  });
  // Extract Spotify track ID
  const trackId = spotifyTrackUrl.split('/track/')[1]?.split('?')[0];
  if (!trackId) return sendMessage(message, "Invalid Spotify track URL.");

  // Get access token
  const data = await spotifyApi.clientCredentialsGrant();
  spotifyApi.setAccessToken(data.body['access_token']);

  // Fetch metadata using Spotify API (requires setup)
  // For demo, let's assume you have the title and artist:
  const track = await spotifyApi.getTrack(trackId);
  const title = track.body.name; // Track title
  const artist = track.body.artists.map(a => a.name).join(', ');

  // Search YouTube
  const query = `${title} ${artist}`;
  const result = await ytSearch(query);
  if (result.videos.length === 0) {
    return sendMessage(message, "❌ No YouTube match found for this Spotify track.");
  }
  // Play the first YouTube result
  await playMusic(message, result.videos[0].url);
}

// DisTube Events
distube.on("playSong", (queue, song) => {
  console.log("✅ Now playing:", song.name);
  if (queue.textChannel) {
    sendMessage(queue, `🎵 **Now playing:** ${song.name} - \`${song.formattedDuration}\``);
  }
});

distube.on("addSong", (queue, song) => {
  console.log("✅ Added to queue:", song.name);
  if (queue.textChannel) {
    sendMessage(queue, `✅ **Added to queue:** ${song.name} - \`${song.formattedDuration}\``);
  }
});

distube.on("addList", (queue, playlist) => {
  console.log("Added playlist:", playlist.name);
  if (queue.textChannel) {
    sendMessage(queue, `✅ **Added playlist:** ${playlist.name} (${playlist.songs.length} songs)`);
    if (playlist.songs.length >= 100 && playlist.source === "spotify") {
      sendMessage(queue, "⚠️ Only the first 100 tracks from this Spotify playlist/album will be loaded due to Spotify limitations.");
    }
  }
});

distube.on("error", (channel, error) => {
  console.error("DisTube error:", error);
  console.error("Error channel/source:", channel);
  
  // Try multiple ways to send error message
  if (channel && typeof channel.send === "function") {
    // channel is a text channel
    sendMessage(channel, "❌ An error occurred while trying to play the audio.");
  } else if (channel && channel.textChannel && typeof channel.textChannel.send === "function") {
    // channel is a queue with textChannel
    sendMessage(channel, "❌ An error occurred while trying to play the audio.");
  } else {
    // Fallback - log only
    console.error("❌ Could not send error message - no valid channel found");
  }
});

distube.on("empty", (queue) => {
  console.log("Voice channel is empty, leaving...");
  if (queue.textChannel) {
    sendMessage(queue, "Voice channel is empty. Leaving the channel...");
  }
});

distube.on("finish", (queue) => {
  console.log("Queue finished");
  if (queue.textChannel) {
    sendMessage(queue, "🏁 Queue finished! No more songs to play.");
  }
});

distube.on("disconnect", (queue) => {
  console.log("Disconnected from voice channel");
  if (queue.textChannel) {
    sendMessage(queue, "⏹️ Disconnected from the voice channel!");
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
  sendMessage(message, `❌ No results found for: ${query}`);
});

distube.on("searchCancel", (message, query) => {
  console.log("🚫 Search cancelled for:", query);
});