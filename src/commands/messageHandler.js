const { sendMessage, formatDuration } = require("../utils/helpers");
const { trackRetryMap, getTrackKey, clearRetryMap } = require("../utils/trackUtils");
const { playMusic } = require("./musicCommands");

async function handleMessage(message) {
  if (message.author.bot || !message.guild) return;

  const prefix = ".";
  if (!message.content.startsWith(prefix)) return;

  const manager = message.client.manager;
  if (!manager || !manager.useable) {
    return sendMessage(message.channel, "❌ Lavalink is not ready yet, please wait a moment.");
  }

  const args = message.content.slice(prefix.length).trim().split(" ");
  const command = args.shift().toLowerCase();

  // Music commands
  if (command === "play") {
    await playMusic(message, args.join(" "));
  }
  
  // Debug and utility commands
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
  
  // Player control commands
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
    if (player.repeatMode === "off" || !player.repeatMode) {
      newLoopMode = "track";
      sendMessage(message.channel, "🔁 Loop enabled: The current song will repeat.");
    } else if (player.loop === "track") {
      newLoopMode = "queue";
      sendMessage(message.channel, "🔄 Queue loop enabled: The entire queue will repeat.");
    } else {
      newLoopMode = "off";
      sendMessage(message.channel, "⏹️ Loop disabled.");
    }
    await player.setRepeatMode(newLoopMode);
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
    const loopStatus = player.repeatMode === "track" ? 'Track' : player.repeatMode === "queue" ? 'Queue' : 'Off';
    sendMessage(message.channel, `🎵 **Now Playing:**\n**${title}** by ${author}\n👤 Requested by: ${requester}\n⏱️ ${formatDuration(player.position)} / ${formatDuration(duration)}\n🔊 Volume: ${player.volume}%\n🔁 Loop: ${loopStatus}`);
  }
  
  // Retry and alternative search commands
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
    clearRetryMap();
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
  
  // Alternative search commands  
  if (command === "alt" || command === "alternative") {
    const { handleAlternativeSearch } = require("./alternativeSearch");
    await handleAlternativeSearch(message, args);
  }
  
  if (command === "playalt") {
    const { handlePlayAlternative } = require("./alternativeSearch");
    await handlePlayAlternative(message, args);
  }
}

module.exports = { handleMessage };