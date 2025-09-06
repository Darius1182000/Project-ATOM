const {
  getTrackKey,
  hasRecentlyRetried,
  markRetryAttempt,
  searchWithFallbacks,
} = require("../utils/trackUtils");
const { sendMessage } = require("../utils/helpers");

// Add a tracking system for ongoing searches to prevent message spam
const ongoingSearches = new Map();

function setupEventHandlers(client) {
  const manager = client.manager;

  // Node connection events
  manager.on("nodeConnect", (node) => {
    console.log(
      `✅ Lavalink node "${node.identifier}" connected successfully!`
    );
  });

  manager.on("nodeDisconnect", (node, reason) => {
    console.log(
      `❌ Lavalink node "${node.identifier}" disconnected: ${reason}`
    );
  });

  manager.on("nodeError", (node, error) => {
    console.error(
      `❌ Lavalink node "${node.identifier}" encountered an error:`,
      error
    );
  });

  manager.on("nodeReconnect", (node) => {
    console.log(`🔄 Lavalink node "${node.identifier}" is reconnecting...`);
  });

  manager.on("error", (error) => {
    console.error("❌ LavalinkManager error:", error);
  });

  manager.on("nodeCreate", (node) => {
    node.on("error", (error) => {
      console.error(
        `❌ Node "${node.options.id}" internal error: ${error.message || error}`
      );
    });

    node.on("trackStuck", (player, track) => {
      if (player.queue.tracks.length > 0) {
        player.skip();
      } else if (player.repeatMode === "track") {
        player.queue.add(player.queue.current);
        player.stop();
        console.log(`Track restarted due to loop: ${track.info.title}`);
      } else {
        console.log(
          `Track stuck detected but queue is empty: ${track.info.title}`
        );
      }
    });
  });

  // Track events
  manager.on("trackStart", (player, track) => {
    console.log("🎵 Track started:", track.info?.title || track.title);
    
    const channel = client.channels.cache.get(player.textChannelId);
    const trackKey = getTrackKey(track);
    
    // Only send "Now Playing" message if we're not in the middle of searching for alternatives
    if (channel && !ongoingSearches.has(trackKey)) {
      const title = track.info?.title || track.title || "Unknown Title";
      const author = track.info?.author || "Unknown Artist";
      sendMessage(channel, `🎵 **Now Playing:** ${title} by ${author}`);
    }
  });

  manager.on("trackEnd", (player, track, payload) => {
    console.log(
      "🔚 Track ended:",
      track.info?.title || track.title,
      "Reason:",
      payload?.reason
    );
  });

  // Enhanced Track Error Handler
  manager.on("trackError", async (player, track, payload) => {
    console.log(
      "❌ Track error:",
      track.info?.title || track.title,
      "Error:",
      payload
    );
    const channel = client.channels.cache.get(player.textChannelId);

    // Check for different types of errors
    const isDecodingError =
      payload.exception?.cause?.includes("AacDecoder") ||
      payload.exception?.cause?.includes("Expected decoding to halt") ||
      payload.exception?.message?.includes("decoding") ||
      payload.exception?.message?.includes(
        "Something went wrong when decoding"
      );

    const isSignInError =
      payload.exception?.message?.includes("Please sign in") ||
      payload.exception?.message?.includes("Sign in to confirm") ||
      payload.exception?.cause?.includes("Please sign in");

    const trackKey = getTrackKey(track);

    if (isSignInError) {
      console.log(
        "🔐 YouTube sign-in error detected - trying alternative search..."
      );

      // Check if we've recently retried this track to prevent loops
      if (hasRecentlyRetried(trackKey)) {
        console.log("⚠️ Track recently retried, skipping to avoid loop");
        if (channel) {
          sendMessage(
            channel,
            `❌ **YouTube access blocked:** ${
              track.info?.title || "Unknown Title"
            } (authentication required)`
          );
        }

        // Skip to next track
        if (player.queue.tracks.length > 0) {
          player.skip();
        }
        return;
      }

      markRetryAttempt(trackKey);

      // Mark this track as being searched for alternatives
      ongoingSearches.set(trackKey, {
        originalTitle: track.info?.title || "Unknown Title",
        startTime: Date.now()
      });

      // Send the initial error message ONCE
      if (channel) {
        sendMessage(
          channel,
          `🔐 **YouTube access restricted:** ${
            track.info?.title || "Unknown Title"
          }\n🔄 Searching for alternatives...`
        );
      }

      try {
        // For sign-in errors, try different search approaches
        const title = track.info?.title || "";
        const author = track.info?.author || "";
        const searchQuery = `${title} ${author}`.trim();

        if (!searchQuery || searchQuery.length < 3) {
          console.log("❌ Cannot create search query from track info");
          ongoingSearches.delete(trackKey);
          if (channel) {
            sendMessage(
              channel,
              `❌ **Cannot retry:** ${
                track.info?.title || "Unknown Title"
              } (insufficient track info)`
            );
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
          `${author}`.trim(),
        ].filter((search) => search.length > 3);

        let foundAlternative = false;

        for (const altSearch of alternativeSearches) {
          try {
            console.log(`🔍 Alternative search: "${altSearch}"`);

            const retryResult = await player.search(
              `ytsearch:${altSearch}`,
              track.requester || track.userData?.requester
            );

            if (
              retryResult &&
              retryResult.tracks &&
              retryResult.tracks.length > 0
            ) {
              // Find a different track
              const alternativeTrack =
                retryResult.tracks.find(
                  (candidateTrack) =>
                    candidateTrack.info?.identifier !== track.info?.identifier
                ) || retryResult.tracks[0];

              if (alternativeTrack) {
                console.log(
                  `✅ Found alternative via search: "${alternativeTrack.info?.title}"`
                );

                // Add requester info
                if (track.requester) {
                  alternativeTrack.requester = track.requester;
                } else if (track.userData?.requester) {
                  alternativeTrack.userData = alternativeTrack.userData || {};
                  alternativeTrack.userData.requester =
                    track.userData.requester;
                }

                await player.queue.add(alternativeTrack);

                // Clean up search tracking and send success message
                ongoingSearches.delete(trackKey);
                
                if (channel) {
                  sendMessage(
                    channel,
                    `✅ **Found alternative:** ${
                      alternativeTrack.info?.title || "Unknown Title"
                    } by ${alternativeTrack.info?.author || "Unknown Artist"}`
                  );
                }

                // Start playing if nothing is currently playing
                if (
                  !player.playing &&
                  !player.paused &&
                  player.queue.tracks.length > 0
                ) {
                  console.log("🎬 Starting playback with alternative track...");
                  await player.play();
                }

                foundAlternative = true;
                break;
              }
            }
          } catch (altError) {
            console.log(
              `❌ Alternative search "${altSearch}" failed:`,
              altError.message
            );
            continue;
          }
        }

        // Clean up search tracking
        ongoingSearches.delete(trackKey);

        if (!foundAlternative) {
          if (channel) {
            sendMessage(
              channel,
              `❌ **No accessible alternatives found for:** ${
                track.info?.title || "Unknown Title"
              }\n💡 Try playing from a different source or use a more specific search term.`
            );
          }
        }
      } catch (retryError) {
        console.log(`❌ Error during sign-in retry:`, retryError.message);
        ongoingSearches.delete(trackKey);
        if (channel) {
          sendMessage(
            channel,
            `❌ **Error finding alternative for:** ${
              track.info?.title || "Unknown Title"
            }`
          );
        }
      }
    } else if (isDecodingError) {
      console.log("🔄 Audio decoding error detected...");

      // Check if we've recently retried this track to prevent loops
      if (hasRecentlyRetried(trackKey)) {
        console.log("⚠️ Track recently retried, skipping to avoid loop");
        if (channel) {
          sendMessage(
            channel,
            `❌ **Skipping problematic track:** ${
              track.info?.title || "Unknown Title"
            } (repeated decoding issues)`
          );
        }

        // Skip to next track
        if (player.queue.tracks.length > 0) {
          player.skip();
        }
        return;
      }

      markRetryAttempt(trackKey);

      // Mark this track as being searched for alternatives
      ongoingSearches.set(trackKey, {
        originalTitle: track.info?.title || "Unknown Title",
        startTime: Date.now()
      });

      // Send the initial error message ONCE
      if (channel) {
        sendMessage(
          channel,
          `❌ **Audio decoding error:** ${
            track.info?.title || "Unknown Title"
          }\n🔄 Searching for alternative version...`
        );
      }

      try {
        // Create search query from track info
        const title = track.info?.title || "";
        const author = track.info?.author || "";
        const searchQuery = `${title} ${author}`.trim();

        if (!searchQuery || searchQuery.length < 3) {
          console.log("❌ Cannot create search query from track info");
          ongoingSearches.delete(trackKey);
          if (channel) {
            sendMessage(
              channel,
              `❌ **Cannot find alternative for:** ${
                track.info?.title || "Unknown Title"
              } (insufficient track info)`
            );
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

        if (
          retryResult &&
          retryResult.tracks &&
          retryResult.tracks.length > 0
        ) {
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
              const durationDiff = Math.abs(
                track.info.length - candidateTrack.info.length
              );
              const maxAcceptableDiff = Math.max(
                60000,
                track.info.length * 0.3
              ); // 60s or 30% of original
              if (durationDiff > maxAcceptableDiff) {
                console.log(
                  `⏭️ Skipping track with very different duration: ${durationDiff}ms difference`
                );
                continue;
              }
            }

            // Found a suitable alternative
            alternativeTrack = candidateTrack;
            break;
          }

          if (alternativeTrack) {
            console.log(
              `✅ Found alternative: "${alternativeTrack.info?.title}" by "${alternativeTrack.info?.author}"`
            );

            // Add requester info to alternative track
            if (track.requester) {
              alternativeTrack.requester = track.requester;
            } else if (track.userData?.requester) {
              alternativeTrack.userData = alternativeTrack.userData || {};
              alternativeTrack.userData.requester = track.userData.requester;
            }

            await player.queue.add(alternativeTrack);

            // Clean up search tracking and send success message
            ongoingSearches.delete(trackKey);
            
            if (channel) {
              sendMessage(
                channel,
                `✅ **Found alternative:** ${
                  alternativeTrack.info?.title || "Unknown Title"
                } by ${alternativeTrack.info?.author || "Unknown Artist"}`
              );
            }

            // Start playing if nothing is currently playing
            if (
              !player.playing &&
              !player.paused &&
              player.queue.tracks.length > 0
            ) {
              console.log("🎬 Starting playbook with alternative track...");
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

      // Clean up search tracking
      ongoingSearches.delete(trackKey);

      // If we get here, we couldn't find an alternative
      if (channel) {
        sendMessage(
          channel,
          `❌ **Could not find working alternative for:** ${
            track.info?.title || "Unknown Title"
          }`
        );
      }
    } else {
      // Handle other types of errors
      if (channel) {
        const errorMsg = payload.exception?.message || "Unknown error";
        sendMessage(
          channel,
          `❌ **Error playing:** ${
            track.info?.title || "Unknown Title"
          }\nReason: ${errorMsg}`
        );
      }
    }

    // Skip to next track if there are more in queue
    if (player.queue.tracks.length > 0) {
      console.log("⏭️ Skipping to next track due to error");
      setTimeout(() => player.skip(), 2000); // Small delay to avoid rapid skipping
    }
  });

  manager.on("trackStuck", (player, track, payload) => {
    console.log(
      "⚠️ Track stuck:",
      track.info?.title || track.title,
      "Threshold:",
      payload?.thresholdMs
    );
    const channel = client.channels.cache.get(player.textChannelId);
    if (channel) {
      sendMessage(
        channel,
        `⚠️ **Track stuck, skipping:** ${
          track.info?.title || track.title || "Unknown Title"
        }`
      );
    }
    player.skip();
  });

  manager.on("queueEnd", (player) => {
    const channel = client.channels.cache.get(player.textChannelId);
    const hadMultipleSongs = (player.queue.previous?.length || 0) >= 2;
    
    if (channel && hadMultipleSongs) {
      sendMessage(
        channel,
        "🔇 Queue ended. Add more songs or I'll leave in 5 minutes!"
      );
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

  // Clean up old search entries periodically (prevent memory leaks)
  setInterval(() => {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes
    
    for (const [trackKey, searchInfo] of ongoingSearches.entries()) {
      if (now - searchInfo.startTime > maxAge) {
        console.log(`🧹 Cleaning up old search entry for: ${searchInfo.originalTitle}`);
        ongoingSearches.delete(trackKey);
      }
    }
  }, 60 * 1000); // Check every minute
}

module.exports = { setupEventHandlers };
