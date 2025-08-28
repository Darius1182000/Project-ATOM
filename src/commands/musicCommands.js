const { sendMessage } = require("../utils/helpers");
const { searchWithFallbacks, isSpotifyUrl } = require("../utils/trackUtils");

// --- Enhanced Play Music Function with Spotify Support ---
async function playMusic(message, query) {
  const manager = message.client.manager;
  if (!query) return sendMessage(message.channel, "Please provide a YouTube link, Spotify link, or search term.");
  
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
    
    // Show different loading message based on source
    if (isSpotifyUrl(query)) {
      sendMessage(message.channel, `🎵 **Searching Spotify and finding YouTube version for:** ${query}`);
    } else {
      sendMessage(message.channel, `🔍 **Searching for:** ${query}`);
    }
    
    // Use enhanced search with Spotify support and fallbacks
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
      let responseMessage = `✅ Playlist **${playlistName}** with ${tracks.length} songs added to the queue!`;
      
      // If it's a Spotify playlist, mention the conversion
      if (isSpotifyUrl(query)) {
        responseMessage += "\n🎵 Tracks will be played from YouTube with original Spotify metadata preserved.";
      }
      
      sendMessage(message.channel, responseMessage);
    } else {
      const track = tracks[0];
      const title = track.info?.title || track.title || 'Unknown Title';
      const author = track.info?.author || 'Unknown Artist';
      
      let responseMessage = `✅ Added to queue: **${title}** by ${author}`;
      
      // If this was a Spotify track converted to YouTube, mention it
      if (track.userData?.originalSpotify) {
        const originalTitle = track.userData.originalSpotify.title;
        const originalArtist = track.userData.originalSpotify.artist;
        responseMessage += `\n🎵 Found YouTube version of Spotify track: **${originalTitle}** by ${originalArtist}`;
      } else if (isSpotifyUrl(query)) {
        responseMessage += "\n🎵 Playing via YouTube with Spotify metadata";
      }
      
      sendMessage(message.channel, responseMessage);
    }
    
    if (!player.playing && !player.paused && player.queue.tracks.length > 0) {
      console.log("🎬 Starting playback...");
      await player.play();
    }
  } catch (err) {
    console.error("Error in playMusic:", err);
    
    // Provide more specific error messages
    let errorMessage = "❌ An error occurred while loading the track.";
    
    if (isSpotifyUrl(query)) {
      errorMessage = "❌ Error loading Spotify track. Please check if the link is valid and try again.";
    } else {
      errorMessage = "❌ Error loading track. Please try again or use a different search term.";
    }
    
    sendMessage(message.channel, errorMessage);
  }
}

// --- Spotify-specific play command ---
async function playSpotify(message, query) {
  if (!query) return sendMessage(message.channel, "Please provide a Spotify link or search term.");
  
  // If it's not a Spotify URL, convert it to a Spotify search
  if (!isSpotifyUrl(query)) {
    query = `spsearch:${query}`;
  }
  
  await playMusic(message, query);
}

// --- YouTube-specific play command ---
async function playYouTube(message, query) {
  if (!query) return sendMessage(message.channel, "Please provide a YouTube link or search term.");
  
  // If it's not already a search query, make it a YouTube search
  if (!query.startsWith('ytsearch:') && !query.includes('youtube.com') && !query.includes('youtu.be')) {
    query = `ytsearch:${query}`;
  }
  
  await playMusic(message, query);
}

module.exports = { 
  playMusic,
  playSpotify,
  playYouTube
};