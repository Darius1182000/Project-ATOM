const { sendMessage, formatDuration } = require('../utils/helpers');

async function handleAlternativeSearch(message, args) {
  const query = args.join(' ');
  if (!query) return sendMessage(message.channel, 'Usage: `.alt <song name>` - Find alternative versions of a song');

  const manager = message.client.manager;
  if (!manager || !manager.useable) {
    return sendMessage(message.channel, '❌ Lavalink is not ready yet, please wait a moment.');
  }

  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) return sendMessage(message.channel, 'Join a voice channel first!');

  let player = manager.players.get(message.guild.id);
  if (!player) {
    try {
      player = manager.createPlayer({
        guildId: message.guild.id,
        voiceChannelId: voiceChannel.id,
        textChannelId: message.channel.id,
        selfDeafen: true,
        volume: 75
      });
    } catch (err) {
      console.error('Error creating player:', err);
      return sendMessage(message.channel, '❌ Failed to create music player.');
    }
  }

  if (player.state !== 'CONNECTED') {
    try {
      await player.connect();
    } catch (err) {
      console.error('Error connecting player:', err);
      return sendMessage(message.channel, '❌ Failed to connect to voice channel.');
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
          if (!results.find((r) => r.info?.identifier === track.info?.identifier)) {
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

    alternativesList += `\n💡 Use \`.playalt <number>\` to select an alternative (e.g., \`.playalt 2\` for the second option)`;

    // Store alternatives for quick selection
    if (!player.alternatives) player.alternatives = {};
    player.alternatives[message.channel.id] = results;

    sendMessage(message.channel, alternativesList);
  } catch (error) {
    console.error('Error in alternative search:', error);
    sendMessage(message.channel, '❌ An error occurred while searching for alternatives.');
  }
}

async function handlePlayAlternative(message, args) {
  const manager = message.client.manager;
  const player = manager.players.get(message.guild.id);

  if (!player || !player.alternatives || !player.alternatives[message.channel.id]) {
    return sendMessage(message.channel, '❌ No alternatives available. Use `.alt <song>` first to find alternatives.');
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

module.exports = {
  handleAlternativeSearch,
  handlePlayAlternative
};
