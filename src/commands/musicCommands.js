const {sendMessage} = require('../utils/helpers');
const {searchWithFallbacks, isSpotifyUrl} = require('../utils/trackUtils');

// --- Enhanced Play Music Function with Spotify Support ---
async function playMusic(message, query) {
    const {channel, author, guild, member, client} = message;
    const manager = client.manager;

    // Constants for user-facing messages
    const MSG_NO_QUERY = 'Please provide a YouTube link, Spotify link, or search term.';
    const MSG_JOIN_VOICE = 'Join a voice channel first!';
    const MSG_LAVALINK_DOWN = '❌ Lavalink is not connected. Please wait for the music server to start.';
    const MSG_CREATE_PLAYER_FAIL = '❌ Failed to create music player. Lavalink may not be connected.';
    const MSG_CONNECT_FAIL = '❌ Failed to connect to voice channel.';

    if (!query) return sendMessage(channel, MSG_NO_QUERY);

    const userVoiceChannel = member?.voice?.channel;
    if (!userVoiceChannel) return sendMessage(channel, MSG_JOIN_VOICE);

    if (!manager?.useable) return sendMessage(channel, MSG_LAVALINK_DOWN);

    // Create or get player
    const player = await getOrCreatePlayer(manager, guild.id, userVoiceChannel.id, channel.id).catch((err) => {
        console.error('Error creating player:', err);
        return null;
    });
    if (!player) return sendMessage(channel, MSG_CREATE_PLAYER_FAIL);

    // Ensure connection
    const connected = await ensureConnected(player).catch((err) => {
        console.error('Error connecting player:', err);
        return false;
    });
    if (!connected) return sendMessage(channel, MSG_CONNECT_FAIL);

    try {
        logSearch(query);
        sendSearchNotice(channel, query);

        const searchResult = await searchWithFallbacks(player, query, author);
        if (!hasTracks(searchResult)) {
            return sendMessage(channel, `❌ No results found for: ${query}`);
        }

        if (searchResult.loadType === 'error') {
            console.error('Search error:', searchResult.exception);
            return sendMessage(
                channel,
                `❌ Error loading track: ${searchResult.exception?.message || 'Unknown error'}`
            );
        }

        const tracks = buildTracksFromResult(searchResult);
        addRequesterIfMissing(tracks, author);

        await player.queue.add(tracks);

        notifyEnqueue(channel, searchResult, tracks, player);

        await startPlaybackIfIdle(player);
    } catch (err) {
        console.error('Error in playMusic:', err);
        sendMessage(channel, buildFriendlyError(query));
    }
}

function logSearch(query) {
    console.log('Searching for:', query);
}

function sendSearchNotice(channel, query) {
    if (isSpotifyUrl(query)) {
        sendMessage(channel, `🎵 **Searching Spotify and finding YouTube version for:** ${query}`);
    } else {
        sendMessage(channel, `🔍 **Searching for:** ${query}`);
    }
}

function hasTracks(searchResult) {
    return Boolean(searchResult && Array.isArray(searchResult.tracks) && searchResult.tracks.length > 0);
}

function buildTracksFromResult(searchResult) {
    const isPlaylist = searchResult.loadType === 'playlist';
    return isPlaylist ? searchResult.tracks : [searchResult.tracks[0]];
}

function addRequesterIfMissing(tracks, requester) {
    for (const t of tracks) {
        if (!t.requester) t.requester = requester;
    }
}

function notifyEnqueue(channel, searchResult, tracks, player) {
    const isPlaylist = searchResult.loadType === 'playlist';
    if (isPlaylist) {
        const playlistName = searchResult.pluginInfo?.name || 'Unknown Playlist';
        sendMessage(channel, `✅ Playlist **${playlistName}** with ${tracks.length} songs added to the queue!`);
        return;
    }

    const track = tracks[0];
    const title = track.info?.title || track.title || 'Unknown Title';
    const author = track.info?.author || 'Unknown Artist';

    if (player.playing || player.queue.current) {
        sendMessage(channel, `✅ Added to queue: **${title}** by ${author}`);
    }
}

async function startPlaybackIfIdle(player) {
    if (!player.playing && !player.paused && player.queue.tracks.length > 0) {
        console.log('🎬 Starting playback...');
        await player.play();
    }
}

async function getOrCreatePlayer(manager, guildId, voiceChannelId, textChannelId) {
    let player = manager.players.get(guildId);
    if (player) return player;

    return manager.createPlayer({
        guildId,
        voiceChannelId,
        textChannelId,
        selfDeafen: true,
        volume: 50,
    });
}

async function ensureConnected(player) {
    if (player.state === 'CONNECTED') return true;
    await player.connect();
    return true;
}

function buildFriendlyError(query) {
    if (isSpotifyUrl(query)) {
        return '❌ Error loading Spotify track. Please check if the link is valid and try again.';
    }
    return '❌ Error loading track. Please try again or use a different search term.';
}

module.exports = {playMusic};
