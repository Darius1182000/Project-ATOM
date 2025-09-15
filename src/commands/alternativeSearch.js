const {sendMessage, formatDuration} = require('../utils/helpers');

const MESSAGES = {
    usage: 'Usage: `.alt <song name>` - Find alternative versions of a song',
    lavalinkNotReady: '❌ Lavalink is not ready yet, please wait a moment.',
    joinVoiceFirst: 'Join a voice channel first!',
    createPlayerFailed: '❌ Failed to create music player.',
    connectFailed: '❌ Failed to connect to voice channel.',
    noAlternatives: (q) => `❌ No alternatives found for: ${q}`,
    noneAvailable: '❌ No alternatives available. Use `.alt <song>` first to find alternatives.',
    invalidNumber: (max) => `❌ Invalid number. Choose between 1 and ${max}.`,
    searching: (q) => `🔍 **Searching for alternatives to:** ${q}`,
    addedAlternative: (title, author) => `✅ Added alternative: **${title}** by ${author}`,
    selectionHint:
        '\n💡 Use `.playalt <number>` to select an alternative (e.g., `.playalt 2` for the second option)',
};

function buildAlternativeQueries(query) {
    const base = `ytsearch:${query}`;
    return [`${base} official`, `${base} audio`, `${base} music`, `${base} topic`, `${base} lyrics`];
}

async function ensurePlayerReady({manager, guildId, voiceChannelId, textChannelId}) {
    let player = manager.players.get(guildId);
    if (!player) {
        player = manager.createPlayer({
            guildId,
            voiceChannelId,
            textChannelId,
            selfDeafen: true,
            volume: 75,
        });
    }
    if (player.state !== 'CONNECTED') {
        await player.connect();
    }
    return player;
}

function pickUniqueFirstTracks(searchResults) {
    const unique = [];
    const seen = new Set();
    for (const result of searchResults) {
        const track = result?.tracks?.[0];
        const id = track?.info?.identifier;
        if (track && id && !seen.has(id)) {
            seen.add(id);
            unique.push(track);
        }
    }
    return unique;
}

function formatAlternativesList(results) {
    const header = `**🎵 Found ${results.length} alternative versions:**\n\n`;
    const lines = results.map((track, i) => {
        const title = track.info?.title ?? 'Unknown Title';
        const author = track.info?.author ?? 'Unknown Artist';
        const duration = formatDuration(track.info?.duration ?? 0);
        return `${i + 1}. **${title}** by ${author} \`${duration}\``;
    });
    return header + lines.join('\n') + MESSAGES.selectionHint;
}

async function handleAlternativeSearch(message, args) {
    const channel = message.channel;
    const query = args.join(' ').trim();
    if (!query) return sendMessage(channel, MESSAGES.usage);

    const manager = message.client.manager;
    if (!manager || !manager.useable) {
        return sendMessage(channel, MESSAGES.lavalinkNotReady);
    }

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return sendMessage(channel, MESSAGES.joinVoiceFirst);

    let player;
    try {
        player = await ensurePlayerReady({
            manager,
            guildId: message.guild.id,
            voiceChannelId: voiceChannel.id,
            textChannelId: channel.id,
        });
    } catch (err) {
        console.error('Error preparing player:', err);
        const msg = err?.message?.includes('connect') ? MESSAGES.connectFailed : MESSAGES.createPlayerFailed;
        return sendMessage(channel, msg);
    }

    sendMessage(channel, MESSAGES.searching(query));

    try {
        const searchQueries = buildAlternativeQueries(query);
        const results = await Promise.all(
            searchQueries.map((q) =>
                player.search(q, message.author).catch((error) => {
                    console.log(`Alternative search failed: ${q}`, error?.message ?? error);
                    return null;
                })
            )
        );
        const uniqueTracks = pickUniqueFirstTracks(results);
        if (uniqueTracks.length === 0) {
            return sendMessage(channel, MESSAGES.noAlternatives(query));
        }

        // Store alternatives for quick selection (per text-channel)
        if (!player.alternatives) player.alternatives = {};
        player.alternatives[channel.id] = uniqueTracks;

        const listMessage = formatAlternativesList(uniqueTracks);
        sendMessage(channel, listMessage);
    } catch (error) {
        console.error('Error in alternative search:', error);
        sendMessage(channel, '❌ An error occurred while searching for alternatives.');
    }
}

async function handlePlayAlternative(message, args) {
    const channel = message.channel;
    const manager = message.client.manager;
    const player = manager.players.get(message.guild.id);
    if (!player || !player.alternatives || !player.alternatives[channel.id]) {
        return sendMessage(channel, MESSAGES.noneAvailable);
    }

    const alternatives = player.alternatives[channel.id];
    const altIndex = Number.parseInt((args?.[0] ?? '').trim(), 10) - 1;
    if (!Number.isInteger(altIndex) || altIndex < 0 || altIndex >= alternatives.length) {
        return sendMessage(channel, MESSAGES.invalidNumber(alternatives.length));
    }

    const selectedTrack = alternatives[altIndex];
    selectedTrack.requester = message.author;
    await player.queue.add(selectedTrack);

    const title = selectedTrack.info?.title ?? 'Unknown Title';
    const author = selectedTrack.info?.author ?? 'Unknown Artist';
    sendMessage(channel, MESSAGES.addedAlternative(title, author));

    if (!player.playing && !player.paused && player.queue.tracks.length > 0) {
        await player.play();
    }

    // Clear alternatives after use
    delete player.alternatives[channel.id];
}

module.exports = {
    handleAlternativeSearch,
    handlePlayAlternative,
};
