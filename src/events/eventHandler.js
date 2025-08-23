const { LoopMode } = require("lavalink-client");
const { trackRetryMap, getTrackKey, hasRecentlyRetried, markRetryAttempt, searchWithFallbacks } = require("../utils/trackUtils");
const { sendMessage } = require("../utils/helpers");

function setupEventHandlers(client) {
  const manager = client.manager;

  // Node connection events
  manager.on("nodeConnect", (node) => {
    console.log(`✅ Lavalink node "${node.identifier}" connected successfully!`);
  });

  manager.on("nodeDisconnect", (node, reason) => {
    console.log(`❌ Lavalink node "${node.identifier}" disconnected: ${reason}`);
  });

  manager.on("nodeError", (node, error) => {
    console.error(`❌ Lavalink node "${node.identifier}" encountered an error:`, error);
  });

  manager.on("nodeReconnect", (node) => {
    console.log(`🔄 Lavalink node "${node.identifier}" is reconnecting...`);
  });

  manager.on("error", (error) => {
    console.error("❌ LavalinkManager error:", error);
  });

  // Track events
  manager.on("trackStart", (player, track) => {
    console.log("🎵 Track started:", track.info?.title || track.title);
    const channel = client.channels.cache.get(player.textChannelId);
    if (channel) {
      const title = track.info?.title || track.title || 'Unknown Title';
      const author = track.info?.author || 'Unknown Artist';
      sendMessage(channel, `🎵 **Now Playing:** ${title} by ${author}`);
    }
  });

  manager.on("trackEnd", (player, track, payload) => {
    console.log("🔚 Track ended:", track.info?.title || track.title, "Reason:", payload?.reason);
  });

  // Enhanced Track Error Handler
  manager.on("trackError", async (player, track, payload) => {
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
          sendMessage(channel, `❌ **YouTube access blocked:** ${track.info?.title || 'Unknown Title'} (authentication required)`);
        }
        
        // Skip to next track
        if (player.queue.tracks.length > 0) {
          player.skip();
        }
        return;
      }
      
      markRetryAttempt(trackKey);
      
      if (channel) {
        sendMessage(channel, `🔐 **YouTube access restricted:** ${track.info?.title || 'Unknown Title'}\n🔄 Trying alternative search methods...`);
      }
      
      try {
        // For sign-in errors, try different search approaches
        const title = track.info?.title || '';
        const author = track.info?.author || '';
        const searchQuery = `${title} ${author}`.trim();
        
        if (!searchQuery || searchQuery.length < 3) {
          console.log("❌ Cannot create search query from track info");
          if (channel) {
            sendMessage(channel, `❌ **Cannot retry:** ${track.info?.title || 'Unknown Title'} (insufficient track info)`);
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
                  sendMessage(channel, `✅ **Found alternative:** ${alternativeTrack.info?.title || 'Unknown Title'} by ${alternativeTrack.info?.author || 'Unknown Artist'}`);
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
            sendMessage(channel, `❌ **No accessible alternatives found for:** ${track.info?.title || 'Unknown Title'}\n💡 Try playing from a different source or use a more specific search term.`);
          }
        }
        
      } catch (retryError) {
        console.log(`❌ Error during sign-in retry:`, retryError.message);
        if (channel) {
          sendMessage(channel, `❌ **Error finding alternative for:** ${track.info?.title || 'Unknown Title'}`);
        }
      }
      
    } else if (isDecodingError) {
      console.log("🔄 Audio decoding error detected...");
      
      // Check if we've recently retried this track to prevent loops
      if (hasRecentlyRetried(trackKey)) {
        console.log("⚠️ Track recently retried, skipping to avoid loop");
        if (channel) {
          sendMessage(channel, `❌ **Skipping problematic track:** ${track.info?.title || 'Unknown Title'} (repeated decoding issues)`);
        }
        
        // Skip to next track
        if (player.queue.tracks.length > 0) {
          player.skip();
        }
        return;
      }
      
      markRetryAttempt(trackKey);
      
      if (channel) {
        sendMessage(channel, `❌ **Audio decoding error:** ${track.info?.title || 'Unknown Title'}\n🔄 Searching for alternative version...`);
      }
      
      try {
        // Create search query from track info
        const title = track.info?.title || '';
        const author = track.info?.author || '';
        const searchQuery = `${title} ${author}`.trim();
        
        if (!searchQuery || searchQuery.length < 3) {
          console.log("❌ Cannot create search query from track info");
          if (channel) {
            sendMessage(channel, `❌ **Cannot find alternative for:** ${track.info?.title || 'Unknown Title'} (insufficient track info)`);
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
              sendMessage(channel, `✅ **Found alternative:** ${alternativeTrack.info?.title || 'Unknown Title'} by ${alternativeTrack.info?.author || 'Unknown Artist'}`);
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
        sendMessage(channel, `❌ **Could not find working alternative for:** ${track.info?.title || 'Unknown Title'}`);
      }
      
    } else {
      // Handle other types of errors
      if (channel) {
        const errorMsg = payload.exception?.message || 'Unknown error';
        sendMessage(channel, `❌ **Error playing:** ${track.info?.title || 'Unknown Title'}\nReason: ${errorMsg}`);
      }
    }
    
    // Skip to next track if there are more in queue
    if (player.queue.tracks.length > 0) {
      console.log("⏭️ Skipping to next track due to error");
      setTimeout(() => player.skip(), 2000); // Small delay to avoid rapid skipping
    }
  });

  manager.on("trackStuck", (player, track, payload) => {
    console.log("⚠️ Track stuck:", track.info?.title || track.title, "Threshold:", payload?.thresholdMs);
    const channel = client.channels.cache.get(player.textChannelId);
    if (channel) {
      sendMessage(channel, `⚠️ **Track stuck, skipping:** ${track.info?.title || track.title || 'Unknown Title'}`);
    }
    player.skip();
  });

  manager.on("queueEnd", (player) => {
    const channel = client.channels.cache.get(player.textChannelId);
    if (channel) {
      sendMessage(channel, "🔇 Queue ended. Add more songs or I'll leave in 5 minutes!");
    }
    
    setTimeout(() => {
      if (!player.queue.current && player.queue.tracks.length === 0) {
        player.destroy();
        if (channel) {
          sendMessage(channel, "👋 Left the voice channel due to inactivity.");
        }
      }
    }, 5 * 60 * 1000);
  });
}

module.exports = { setupEventHandlers };