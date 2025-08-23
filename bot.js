// --- IMPORTS ---
require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { LavalinkManager, LoopMode } = require("lavalink-client");

// --- Environment Variable Validation ---
const requiredEnvVars = {
  TOKEN: process.env.DISCORD_TOKEN,
  LAVALINK_HOST: process.env.LAVALINK_HOST || "localhost",
  LAVALINK_PORT: process.env.LAVALINK_PORT || "2333",
  LAVALINK_PASSWORD: process.env.LAVALINK_PASSWORD || "youshallnotpass"
};

if (!requiredEnvVars.TOKEN) {
  console.error("❌ Missing required environment variable: TOKEN");
  process.exit(1);
}

// --- Discord Client Initialization ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// --- LAVALINK INITIALIZATION ---
client.manager = new LavalinkManager({
  nodes: [{
    id: "main-node",
    host: requiredEnvVars.LAVALINK_HOST,
    port: parseInt(requiredEnvVars.LAVALINK_PORT),
    authorization: requiredEnvVars.LAVALINK_PASSWORD,
    secure: false,
    retryAmount: 5,
    retryDelay: 10000,
  }],
  sendToShard: (guildId, payload) => {
    const guild = client.guilds.cache.get(guildId);
    if (guild) guild.shard.send(payload);
  },
  client: {
    id: "PLACEHOLDER",
  },
  playerOptions: {
    clientBasedPositionUpdate: true,
    defaultSearchPlatform: "ytsearch",
    volume: 75,
  },
  queueOptions: {
    maxPreviousTracks: 25,
  },
});

// Track retry attempts to prevent infinite loops
const trackRetryMap = new Map();

// --- Utility Functions ---
function getTrackKey(track) {
  return `${track.info?.identifier || track.identifier || 'unknown'}_${track.info?.title || track.title || 'unknown'}`;
}

function hasRecentlyRetried(trackKey) {
  const lastRetry = trackRetryMap.get(trackKey);
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  return lastRetry && lastRetry > fiveMinutesAgo;
}

function markRetryAttempt(trackKey) {
  trackRetryMap.set(trackKey, Date.now());
}

// Clean up old retry records every 10 minutes
setInterval(() => {
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [key, timestamp] of trackRetryMap.entries()) {
    if (timestamp < tenMinutesAgo) {
      trackRetryMap.delete(key);
    }
  }
}, 10 * 60 * 1000);

// --- Enhanced search function with multiple fallbacks ---
async function searchWithFallbacks(player, originalQuery, requester) {
  const searchStrategies = [
    // Strategy 1: Original query
    originalQuery,
    
    // Strategy 2: If it's a URL, try ytsearch with extracted info
    originalQuery.includes('youtube.com') || originalQuery.includes('youtu.be') 
      ? `ytsearch:${extractVideoTitle(originalQuery)}` 
      : null,
    
    // Strategy 3: Add "official" to potentially get better quality/format
    `ytsearch:${originalQuery.replace('ytsearch:', '')} official`,
    
    // Strategy 4: Add "audio" to get audio-only versions (often more stable)
    `ytsearch:${originalQuery.replace('ytsearch:', '')} audio`,
    
    // Strategy 5: Add "music" to get music-focused results
    `ytsearch:${originalQuery.replace('ytsearch:', '')} music`,
    
    // Strategy 6: Try without extra words that might complicate search
    `ytsearch:${originalQuery.replace('ytsearch:', '').split(' ').slice(0, 4).join(' ')}`,
    
    // Strategy 7: Add "topic" to get auto-generated music videos (often more stable)
    `ytsearch:${originalQuery.replace('ytsearch:', '')} topic`,
    
    // Strategy 8: Try with "lyrics" to get lyric videos (different encoding)
    `ytsearch:${originalQuery.replace('ytsearch:', '')} lyrics`
  ].filter(Boolean);

  for (let i = 0; i < searchStrategies.length; i++) {
    try {
      console.log(`🔍 Search strategy ${i + 1}: "${searchStrategies[i]}"`);
      const result = await player.search(searchStrategies[i], requester);
      
      if (result && result.tracks && result.tracks.length > 0) {
        // For strategies after the first, try to find the best match
        if (i > 0 && result.tracks.length > 1) {
          // Sort tracks by quality indicators and format preferences
          const rankedTracks = result.tracks.map(track => {
            let score = 0;
            const title = track.info?.title?.toLowerCase() || '';
            const author = track.info?.author?.toLowerCase() || '';
            
            // Prefer tracks without problematic indicators
            if (title.includes('official')) score += 3;
            if (title.includes('audio')) score += 2;
            if (title.includes('music')) score += 2;
            if (author.includes('topic')) score += 2;
            if (title.includes('lyrics')) score += 1;
            
            // Penalize potentially problematic content
            if (title.includes('live')) score -= 2;
            if (title.includes('stream')) score -= 2;
            if (title.includes('radio')) score -= 1;
            if (title.includes('remix') && !title.includes('official')) score -= 1;
            
            return { track, score };
          }).sort((a, b) => b.score - a.score);
          
          const bestTrack = rankedTracks[0].track;
          console.log(`📊 Selected track "${bestTrack.info?.title}" with score ${rankedTracks[0].score}`);
          
          return { ...result, tracks: [bestTrack] };
        }
        return result;
      }
    } catch (error) {
      console.log(`❌ Search strategy ${i + 1} failed:`, error.message);
      continue;
    }
  }
  
  return null;
}

function extractVideoTitle(url) {
  // This is a simple extraction - in a real bot you might want to fetch the actual title
  // For now, return a generic search term
  return "music video";
}

// --- Event Listeners ---
client.manager.on("nodeConnect", (node) => {
  console.log(`✅ Lavalink node "${node.identifier}" connected successfully!`);
});

client.manager.on("nodeDisconnect", (node, reason) => {
  console.log(`❌ Lavalink node "${node.identifier}" disconnected: ${reason}`);
});

client.manager.on("nodeError", (node, error) => {
  console.error(`❌ Lavalink node "${node.identifier}" encountered an error:`, error);
});

client.manager.on("nodeReconnect", (node) => {
  console.log(`🔄 Lavalink node "${node.identifier}" is reconnecting...`);
});

client.manager.on("error", (error) => {
  console.error("❌ LavalinkManager error:", error);
});

client.manager.on("trackStart", (player, track) => {
  console.log("🎵 Track started:", track.info?.title || track.title);
  const channel = client.channels.cache.get(player.textChannelId);
  if (channel) {
    const title = track.info?.title || track.title || 'Unknown Title';
    const author = track.info?.author || 'Unknown Artist';
    channel.send(`🎵 **Now Playing:** ${title} by ${author}`);
  }
});

client.manager.on("trackEnd", (player, track, payload) => {
  console.log("🔚 Track ended:", track.info?.title || track.title, "Reason:", payload?.reason);
});

// --- Enhanced Track Error Handler ---
client.manager.on("trackError", async (player, track, payload) => {
  console.log("❌ Track error:", track.info?.title || track.title, "Error:", payload);
  const channel = client.channels.cache.get(player.textChannelId);
  
  // Check for different types of errors
  const isDecodingError = payload.exception?.cause?.includes('AacDecoder') || 
                         payload.exception?.cause?.includes('Expected decoding to halt') ||
                         payload.exception?.message?.includes('decoding') ||
                         payload.exception?.message?.includes('Something went wrong when decoding');
  
  const isSignInError = payload.exception?.message?.includes('Please sign in') ||
                       payload.exception?.message?.includes('Sign in to confirm') ||
                       payload.exception?.cause?.includes('Please sign in');
  
  const trackKey = getTrackKey(track);
  
  if (isSignInError) {
    console.log("🔐 YouTube sign-in error detected - trying alternative search...");
    
    // Check if we've recently retried this track to prevent loops
    if (hasRecentlyRetried(trackKey)) {
      console.log("⚠️ Track recently retried, skipping to avoid loop");
      if (channel) {
        channel.send(`❌ **YouTube access blocked:** ${track.info?.title || 'Unknown Title'} (authentication required)`);
      }
      
      // Skip to next track
      if (player.queue.tracks.length > 0) {
        player.skip();
      }
      return;
    }
    
    markRetryAttempt(trackKey);
    
    if (channel) {
      channel.send(`🔐 **YouTube access restricted:** ${track.info?.title || 'Unknown Title'}\n🔄 Trying alternative search methods...`);
    }
    
    try {
      // For sign-in errors, try different search approaches
      const title = track.info?.title || '';
      const author = track.info?.author || '';
      const searchQuery = `${title} ${author}`.trim();
      
      if (!searchQuery || searchQuery.length < 3) {
        console.log("❌ Cannot create search query from track info");
        if (channel) {
          channel.send(`❌ **Cannot retry:** ${track.info?.title || 'Unknown Title'} (insufficient track info)`);
        }
        
        if (player.queue.tracks.length > 0) {
          player.skip();
        }
        return;
      }
      
      // Try multiple alternative search strategies
      const alternativeSearches = [
        `${searchQuery} audio`,
        `${searchQuery} music`,
        `${searchQuery} official`,
        `${title}`.trim(),
        `${author}`.trim()
      ].filter(search => search.length > 3);
      
      let foundAlternative = false;
      
      for (const altSearch of alternativeSearches) {
        try {
          console.log(`🔍 Alternative search: "${altSearch}"`);
          
          const retryResult = await player.search(`ytsearch:${altSearch}`, track.requester || track.userData?.requester);
          
          if (retryResult && retryResult.tracks && retryResult.tracks.length > 0) {
            // Find a different track
            const alternativeTrack = retryResult.tracks.find(candidateTrack => 
              candidateTrack.info?.identifier !== track.info?.identifier
            ) || retryResult.tracks[0];
            
            if (alternativeTrack) {
              console.log(`✅ Found alternative via search: "${alternativeTrack.info?.title}"`);
              
              // Add requester info
              if (track.requester) {
                alternativeTrack.requester = track.requester;
              } else if (track.userData?.requester) {
                alternativeTrack.userData = alternativeTrack.userData || {};
                alternativeTrack.userData.requester = track.userData.requester;
              }
              
              await player.queue.add(alternativeTrack);
              
              if (channel) {
                channel.send(`✅ **Found alternative:** ${alternativeTrack.info?.title || 'Unknown Title'} by ${alternativeTrack.info?.author || 'Unknown Artist'}`);
              }
              
              // Start playing if nothing is currently playing
              if (!player.playing && !player.paused && player.queue.tracks.length > 0) {
                console.log("🎬 Starting playback with alternative track...");
                await player.play();
              }
              
              foundAlternative = true;
              break;
            }
          }
        } catch (altError) {
          console.log(`❌ Alternative search "${altSearch}" failed:`, altError.message);
          continue;
        }
      }
      
      if (!foundAlternative) {
        if (channel) {
          channel.send(`❌ **No accessible alternatives found for:** ${track.info?.title || 'Unknown Title'}\n💡 Try playing from a different source or use a more specific search term.`);
        }
      }
      
    } catch (retryError) {
      console.log(`❌ Error during sign-in retry:`, retryError.message);
      if (channel) {
        channel.send(`❌ **Error finding alternative for:** ${track.info?.title || 'Unknown Title'}`);
      }
    }
    
  } else if (isDecodingError) {
    console.log("🔄 Audio decoding error detected...");
    
    // Check if we've recently retried this track to prevent loops
    if (hasRecentlyRetried(trackKey)) {
      console.log("⚠️ Track recently retried, skipping to avoid loop");
      if (channel) {
        channel.send(`❌ **Skipping problematic track:** ${track.info?.title || 'Unknown Title'} (repeated decoding issues)`);
      }
      
      // Skip to next track
      if (player.queue.tracks.length > 0) {
        player.skip();
      }
      return;
    }
    
    markRetryAttempt(trackKey);
    
    if (channel) {
      channel.send(`❌ **Audio decoding error:** ${track.info?.title || 'Unknown Title'}\n🔄 Searching for alternative version...`);
    }
    
    try {
      // Create search query from track info
      const title = track.info?.title || '';
      const author = track.info?.author || '';
      const searchQuery = `${title} ${author}`.trim();
      
      if (!searchQuery || searchQuery.length < 3) {
        console.log("❌ Cannot create search query from track info");
        if (channel) {
          channel.send(`❌ **Cannot find alternative for:** ${track.info?.title || 'Unknown Title'} (insufficient track info)`);
        }
        
        if (player.queue.tracks.length > 0) {
          player.skip();
        }
        return;
      }
      
      console.log(`🔍 Searching for alternatives to: "${searchQuery}"`);
      
      const retryResult = await searchWithFallbacks(
        player, 
        `ytsearch:${searchQuery}`, 
        track.requester || track.userData?.requester
      );
      
      if (retryResult && retryResult.tracks && retryResult.tracks.length > 0) {
        // Try to find a track that's different from the failed one
        let alternativeTrack = null;
        
        for (const candidateTrack of retryResult.tracks) {
          // Skip if it's the exact same track
          if (candidateTrack.info?.identifier === track.info?.identifier) {
            console.log("⏭️ Skipping same track identifier");
            continue;
          }
          
          // Skip if it's too different in duration (probably wrong song)
          if (track.info?.length && candidateTrack.info?.length) {
            const durationDiff = Math.abs(track.info.length - candidateTrack.info.length);
            const maxAcceptableDiff = Math.max(60000, track.info.length * 0.3); // 60s or 30% of original
            if (durationDiff > maxAcceptableDiff) {
              console.log(`⏭️ Skipping track with very different duration: ${durationDiff}ms difference`);
              continue;
            }
          }
          
          // Found a suitable alternative
          alternativeTrack = candidateTrack;
          break;
        }
        
        if (alternativeTrack) {
          console.log(`✅ Found alternative: "${alternativeTrack.info?.title}" by "${alternativeTrack.info?.author}"`);
          
          // Add requester info to alternative track
          if (track.requester) {
            alternativeTrack.requester = track.requester;
          } else if (track.userData?.requester) {
            alternativeTrack.userData = alternativeTrack.userData || {};
            alternativeTrack.userData.requester = track.userData.requester;
          }
          
          await player.queue.add(alternativeTrack);
          
          if (channel) {
            channel.send(`✅ **Found alternative:** ${alternativeTrack.info?.title || 'Unknown Title'} by ${alternativeTrack.info?.author || 'Unknown Artist'}`);
          }
          
          // Start playing if nothing is currently playing
          if (!player.playing && !player.paused && player.queue.tracks.length > 0) {
            console.log("🎬 Starting playback with alternative track...");
            await player.play();
          }
          return;
        } else {
          console.log("❌ No suitable alternative found");
        }
      }
    } catch (retryError) {
      console.log(`❌ Error during alternative search:`, retryError.message);
    }
    
    // If we get here, we couldn't find an alternative
    if (channel) {
      channel.send(`❌ **Could not find working alternative for:** ${track.info?.title || 'Unknown Title'}`);
    }
    
  } else {
    // Handle other types of errors
    if (channel) {
      const errorMsg = payload.exception?.message || 'Unknown error';
      channel.send(`❌ **Error playing:** ${track.info?.title || 'Unknown Title'}\nReason: ${errorMsg}`);
    }
  }
  
  // Skip to next track if there are more in queue
  if (player.queue.tracks.length > 0) {
    console.log("⏭️ Skipping to next track due to error");
    setTimeout(() => player.skip(), 2000); // Small delay to avoid rapid skipping
  }
});

client.manager.on("trackStuck", (player, track, payload) => {
  console.log("⚠️ Track stuck:", track.info?.title || track.title, "Threshold:", payload?.thresholdMs);
  const channel = client.channels.cache.get(player.textChannelId);
  if (channel) {
    channel.send(`⚠️ **Track stuck, skipping:** ${track.info?.title || track.title || 'Unknown Title'}`);
  }
  player.skip();
});

client.manager.on("queueEnd", (player) => {
  const channel = client.channels.cache.get(player.textChannelId);
  if (channel) {
    channel.send("🔇 Queue ended. Add more songs or I'll leave in 5 minutes!");
  }
  
  setTimeout(() => {
    if (!player.queue.current && player.queue.tracks.length === 0) {
      player.destroy();
      if (channel) {
        channel.send("👋 Left the voice channel due to inactivity.");
      }
    }
  }, 5 * 60 * 1000);
});

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

// --- MESSAGE COMMAND HANDLER ---
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    const prefix = ".";
    if (!message.content.startsWith(prefix)) return;

    const manager = message.client.manager;
    if (!manager || !manager.useable) {
        return sendMessage(message.channel, "❌ Lavalink is not ready yet, please wait a moment.");
    }

    const args = message.content.slice(prefix.length).trim().split(" ");
    const command = args.shift().toLowerCase();

    if (command === "play") {
        await playMusic(message, args.join(" "));
    }
    
    if (command === "debug") {
        const manager = message.client.manager;
        const managerProps = Object.getOwnPropertyNames(manager);
        const managerMethods = managerProps.filter(name => typeof manager[name] === 'function');
        const utilsProps = manager.utils ? Object.getOwnPropertyNames(manager.utils) : [];
        const utilsMethods = manager.utils ? utilsProps.filter(name => typeof manager.utils[name] === 'function') : [];
        
        sendMessage(message.channel, `**Manager properties:** ${managerProps.slice(0, 10).join(', ')}\n**Manager methods:** ${managerMethods.slice(0, 10).join(', ')}\n**Utils properties:** ${utilsProps.slice(0, 10).join(', ')}\n**Utils methods:** ${utilsMethods.slice(0, 10).join(', ')}`);
    }
    
    if (command === "test") {
        // Test with a known working video
        const testUrls = [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // Rick Roll - usually works
            "ytsearch:Never gonna give you up rick astley",
            "ytsearch:Despacito Luis Fonsi"
        ];
        
        const testUrl = args[0] ? args.join(" ") : testUrls[Math.floor(Math.random() * testUrls.length)];
        sendMessage(message.channel, `🧪 **Testing with:** ${testUrl}`);
        await playMusic(message, testUrl);
    }
    
    if (command === "status") {
        const player = manager.players.get(message.guild.id);
        if (!player) {
            return sendMessage(message.channel, "No player found for this guild.");
        }
        
        const status = {
            connected: player.connected,
            playing: player.playing,
            paused: player.paused,
            position: formatDuration(player.position),
            volume: player.volume,
            queueSize: player.queue.tracks.length,
            currentTrack: player.queue.current?.info?.title || "None",
            voiceChannel: player.voiceChannelId,
            textChannel: player.textChannelId
        };
        
        sendMessage(message.channel, `**Player Status:**\n\`\`\`json\n${JSON.stringify(status, null, 2)}\n\`\`\``);
    }
    
    if (command === "gabriel") {
        sendMessage(message.channel, "Gabriel del Mundo do Santos Alveira Pedro Sales Hectorus Las Vegas Official");
    }
    
    if (command === "stop") {
        const player = manager.players.get(message.guild.id);
        if (player) {
            player.destroy();
            sendMessage(message.channel, "⏹️ Stopped the music and left the channel.");
        } else {
            sendMessage(message.channel, "Nothing is playing right now.");
        }
    }
    
    if (command === "skip") {
        const player = manager.players.get(message.guild.id);
        if (player && player.queue.current) {
            const currentTrack = player.queue.current;
            const title = currentTrack.info?.title || currentTrack.title || 'Unknown Title';
            player.skip();
            sendMessage(message.channel, `⏭️ Skipped: **${title}**`);
        } else {
            sendMessage(message.channel, "Nothing is playing right now.");
        }
    }
    
    if (command === "pause") {
        const player = manager.players.get(message.guild.id);
        if (player && player.queue.current) {
            player.pause(!player.paused);
            sendMessage(message.channel, player.paused ? "⏸️ Paused the music!" : "▶️ Resumed the music!");
        } else {
            sendMessage(message.channel, "Nothing is playing right now.");
        }
    }
    
    if (command === "queue") {
        const player = manager.players.get(message.guild.id);
        if (!player || (!player.queue.current && player.queue.tracks.length === 0)) {
            return sendMessage(message.channel, "The queue is empty.");
        }
        const current = player.queue.current;
        const upcoming = player.queue.tracks.slice(0, 10);
        const currentTitle = current.info?.title || current.title || 'Unknown Title';
        const currentDuration = current.info?.duration || current.duration || 0;
        let queueList = `**Now Playing:** ${currentTitle} - \`${formatDuration(currentDuration)}\`\n\n`;
        if (upcoming.length > 0) {
            queueList += "**Up Next:**\n" + upcoming.map((song, i) => {
                const title = song.info?.title || song.title || 'Unknown Title';
                const duration = song.info?.duration || song.duration || 0;
                return `${i + 1}. ${title} - \`${formatDuration(duration)}\``;
            }).join("\n");
        }
        sendMessage(message.channel, `**Queue:**\n${queueList}`);
    }
    
    if (command === "loop") {
        const player = manager.players.get(message.guild.id);
        if (!player) return sendMessage(message.channel, "Nothing is playing right now.");
        let newLoopMode;
        if (player.loop === LoopMode.NONE) {
            newLoopMode = LoopMode.TRACK;
            sendMessage(message.channel, "🔁 Loop enabled: The current song will repeat.");
        } else if (player.loop === LoopMode.TRACK) {
            newLoopMode = LoopMode.QUEUE;
            sendMessage(message.channel, "🔄 Queue loop enabled: The entire queue will repeat.");
        } else {
            newLoopMode = LoopMode.NONE;
            sendMessage(message.channel, "⏹️ Loop disabled.");
        }
        player.setLoop(newLoopMode);
    }
    
    if (command === "shuffle") {
        const player = manager.players.get(message.guild.id);
        if (!player || player.queue.tracks.length < 2) return sendMessage(message.channel, "Not enough songs in queue to shuffle.");
        player.queue.shuffle();
        sendMessage(message.channel, "🔀 Queue shuffled!");
    }
    
    if (command === "volume") {
        const player = manager.players.get(message.guild.id);
        if (!player) return sendMessage(message.channel, "Nothing is playing right now.");
        const volume = parseInt(args[0]);
        if (isNaN(volume) || volume < 0 || volume > 150) return sendMessage(message.channel, `Current volume: **${player.volume}%**\nUsage: \`.volume <0-150>\``);
        player.setVolume(volume);
        sendMessage(message.channel, `🔊 Volume set to **${volume}%**`);
    }
    
    if (command === "nowplaying" || command === "np") {
        const player = manager.players.get(message.guild.id);
        if (!player || !player.queue.current) return sendMessage(message.channel, "Nothing is playing right now.");
        const current = player.queue.current;
        const title = current.info?.title || current.title || 'Unknown Title';
        const author = current.info?.author || 'Unknown Artist';
        const duration = current.info?.duration || current.duration || 0;
        const requester = current.requester?.tag || current.requester?.username || 'Unknown User';
        const loopStatus = player.loop === LoopMode.TRACK ? 'Track' : player.loop === LoopMode.QUEUE ? 'Queue' : 'Off';
        sendMessage(message.channel, `🎵 **Now Playing:**\n**${title}** by ${author}\n👤 Requested by: ${requester}\n⏱️ ${formatDuration(player.position)} / ${formatDuration(duration)}\n🔊 Volume: ${player.volume}%\n🔁 Loop: ${loopStatus}`);
    }
    
    if (command === "retry") {
        const player = manager.players.get(message.guild.id);
        if (!player || !player.queue.current) return sendMessage(message.channel, "Nothing is currently playing to retry.");
        
        const currentTrack = player.queue.current;
        const trackKey = getTrackKey(currentTrack);
        
        // Force a retry by clearing the recent retry record
        trackRetryMap.delete(trackKey);
        
        sendMessage(message.channel, `🔄 **Force retrying:** ${currentTrack.info?.title || 'Unknown Title'}`);
        
        // Skip current track to trigger the retry logic
        player.skip();
    }
    
    if (command === "clearretries") {
        trackRetryMap.clear();
        sendMessage(message.channel, "🧹 **Cleared all retry records.** Tracks can now be retried again.");
    }
    
    if (command === "health" || command === "checkyt") {
        const manager = message.client.manager;
        const testUrls = [
            "ytsearch:test audio",
            "ytsearch:never gonna give you up"
        ];
        
        sendMessage(message.channel, "🩺 **Checking YouTube connectivity...**");
        
        let workingCount = 0;
        for (const testUrl of testUrls) {
            try {
                const player = manager.players.get(message.guild.id);
                if (!player) {
                    sendMessage(message.channel, "⚠️ No active player found. Join a voice channel and try `.play` first.");
                    return;
                }
                
                const result = await player.search(testUrl, message.author);
                if (result && result.tracks && result.tracks.length > 0) {
                    workingCount++;
                    console.log(`✅ Test search "${testUrl}" successful`);
                } else {
                    console.log(`❌ Test search "${testUrl}" returned no results`);
                }
            } catch (error) {
                console.log(`❌ Test search "${testUrl}" failed:`, error.message);
            }
        }
        
        if (workingCount === testUrls.length) {
            sendMessage(message.channel, "✅ **YouTube connectivity: GOOD** - All test searches successful");
        } else if (workingCount > 0) {
            sendMessage(message.channel, `⚠️ **YouTube connectivity: PARTIAL** - ${workingCount}/${testUrls.length} test searches successful`);
        } else {
            sendMessage(message.channel, "❌ **YouTube connectivity: POOR** - All test searches failed\n💡 Try restarting Lavalink or check your configuration");
        }
    }
    
    if (command === "alt" || command === "alternative") {
        const query = args.join(" ");
        if (!query) return sendMessage(message.channel, "Usage: `.alt <song name>` - Find alternative versions of a song");
        
        const manager = message.client.manager;
        if (!manager || !manager.useable) {
            return sendMessage(message.channel, "❌ Lavalink is not ready yet, please wait a moment.");
        }
        
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return sendMessage(message.channel, "Join a voice channel first!");
        
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
                return sendMessage(message.channel, "❌ Failed to create music player.");
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
        
        sendMessage(message.channel, `🔍 **Searching for alternatives to:** ${query}`);
        
        try {
            // Search for multiple versions
            const alternatives = [
                `ytsearch:${query} official`,
                `ytsearch:${query} audio`,
                `ytsearch:${query} music`,
                `ytsearch:${query} topic`,
                `ytsearch:${query} lyrics`
            ];
            
            let results = [];
            for (const altQuery of alternatives) {
                try {
                    const result = await player.search(altQuery, message.author);
                    if (result && result.tracks && result.tracks.length > 0) {
                        const track = result.tracks[0];
                        if (!results.find(r => r.info?.identifier === track.info?.identifier)) {
                            results.push(track);
                        }
                    }
                } catch (error) {
                    console.log(`Alternative search failed: ${altQuery}`, error.message);
                }
            }
            
            if (results.length === 0) {
                return sendMessage(message.channel, `❌ No alternatives found for: ${query}`);
            }
            
            // Show the alternatives
            let alternativesList = `**🎵 Found ${results.length} alternative versions:**\n\n`;
            results.forEach((track, index) => {
                const title = track.info?.title || 'Unknown Title';
                const author = track.info?.author || 'Unknown Artist';
                const duration = formatDuration(track.info?.duration || 0);
                alternativesList += `${index + 1}. **${title}** by ${author} \`${duration}\`\n`;
            });
            
            alternativesList += `\n💡 Use \`.play <number>\` to select an alternative (e.g., \`.play 2\` for the second option)`;
            
            // Store alternatives for quick selection
            if (!player.alternatives) player.alternatives = {};
            player.alternatives[message.channel.id] = results;
            
            sendMessage(message.channel, alternativesList);
            
        } catch (error) {
            console.error("Error in alternative search:", error);
            sendMessage(message.channel, "❌ An error occurred while searching for alternatives.");
        }
    }
    
    if (command === "playalt" && args.length > 0) {
        const manager = message.client.manager;
        const player = manager.players.get(message.guild.id);
        
        if (!player || !player.alternatives || !player.alternatives[message.channel.id]) {
            return sendMessage(message.channel, "❌ No alternatives available. Use `.alt <song>` first to find alternatives.");
        }
        
        const altIndex = parseInt(args[0]) - 1;
        const alternatives = player.alternatives[message.channel.id];
        
        if (isNaN(altIndex) || altIndex < 0 || altIndex >= alternatives.length) {
            return sendMessage(message.channel, `❌ Invalid number. Choose between 1 and ${alternatives.length}.`);
        }
        
        const selectedTrack = alternatives[altIndex];
        selectedTrack.requester = message.author;
        
        await player.queue.add(selectedTrack);
        
        const title = selectedTrack.info?.title || 'Unknown Title';
        const author = selectedTrack.info?.author || 'Unknown Artist';
        sendMessage(message.channel, `✅ Added alternative: **${title}** by ${author}`);
        
        if (!player.playing && !player.paused && player.queue.tracks.length > 0) {
            await player.play();
        }
        
        // Clear alternatives after use
        delete player.alternatives[message.channel.id];
    }
});

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

function sendMessage(channel, message) {
    if (channel && typeof channel.send === "function") {
        channel.send(message).catch(err => console.warn("⚠ Failed to send message:", err.message));
    } else {
        console.warn("⚠ Could not send message — no valid channel found.");
    }
}

function formatDuration(ms) {
    if (!ms || !isFinite(ms)) return "00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// --- LOGIN ---
client.login(requiredEnvVars.TOKEN);