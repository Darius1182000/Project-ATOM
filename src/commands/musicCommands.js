const { sendMessage } = require("../utils/helpers");
const { searchWithFallbacks } = require("../utils/trackUtils");

// --- Enhanced Play Music Function ---
async function playMusic(message, query) {
  const manager = message.client.manager;
  if (!query) return sendMessage(message.channel, "Please provide a YouTube link or search term.");
  
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) return sendMessage(message.channel, "Join a voice channel first!");
  
  if (!manager.useable) {
    return sendMessage(message.channel, "❌ Lavalink is not connected. Please wait for the music server to start.");
  }
  
  let player = manager.players.get(message.guild.id);
  if (!player) {
    try {
      player = manager.createPlayer({
        guildId: message.guild.id,
        voiceChannelId: voiceChannel.id,
        textChannelId: message.channel.id,
        selfDeafen: true,
        volume: 75,
      });
    } catch (err) {
      console.error("Error creating player:", err);
      return sendMessage(message.channel, "❌ Failed to create music player. Lavalink may not be connected.");
    }
  }
  
  if (player.state !== "CONNECTED") {
    try {
      await player.connect();
    } catch (err) {
      console.error("Error connecting player:", err);
      return sendMessage(message.channel, "❌ Failed to connect to voice channel.");
    }
  }
  
  try {
    console.log("Searching for:", query);
    
    // Use enhanced search with fallbacks
    const searchResult = await searchWithFallbacks(player, query, message.author);
    
    if (!searchResult || !searchResult.tracks || searchResult.tracks.length === 0) {
      return sendMessage(message.channel, `❌ No results found for: ${query}`);
    }
    
    if (searchResult.loadType === "error") {
      console.error("Search error:", searchResult.exception);
      return sendMessage(message.channel, `❌ Error loading track: ${searchResult.exception?.message || 'Unknown error'}`);
    }
    
    const tracks = searchResult.loadType === "playlist" 
      ? searchResult.tracks 
      : [searchResult.tracks[0]];
    
    // Add requester information to tracks
    tracks.forEach(track => {
      if (!track.requester) {
        track.requester = message.author;
      }
    });
    
    await player.queue.add(tracks);
    
    if (searchResult.loadType === "playlist") {
      const playlistName = searchResult.pluginInfo?.name || 'Unknown Playlist';
      sendMessage(message.channel, `✅ Playlist **${playlistName}** with ${tracks.length} songs added to the queue!`);
    } else {
      const track = tracks[0];
      const title = track.info?.title || track.title || 'Unknown Title';
      const author = track.info?.author || 'Unknown Artist';
      sendMessage(message.channel, `✅ Added to queue: **${title}** by ${author}`);
    }
    
    if (!player.playing && !player.paused && player.queue.tracks.length > 0) {
      console.log("🎬 Starting playback...");
      await player.play();
    }
  } catch (err) {
    console.error("Error in playMusic:", err);
    sendMessage(message.channel, "❌ An error occurred while loading the track. Please try again or use a different search term.");
  }
}

module.exports = { playMusic };