const {sendMessage, formatDuration} = require('../utils/helpers');
const {playMusic} = require('./musicCommands');

const COMMAND_PREFIX = '.';
const MAX_LIST_COUNT = 10;
const REPEAT_MODES = {OFF: 'off', TRACK: 'track', QUEUE: 'queue'};

function parseCommandArgs(content) {
    const withoutPrefix = content.slice(COMMAND_PREFIX.length).trim();
    const [command, ...args] = withoutPrefix.split(' ');
    return {command: command.toLowerCase(), args};
}

function safeGetTitle(track) {
    return track?.info?.title || track?.title || 'Unknown Title';
}

function getPlayer(manager, guildId) {
    return manager.players.get(guildId);
}

function buildStatusPayload(player) {
    const currentTrack = player.queue.current;
    const status = {
        connected: player.connected,
        playing: player.playing,
        paused: player.paused,
        position: formatDuration(player.position),
        volume: player.volume,
        queueSize: player.queue.tracks.length,
        currentTrack: safeGetTitle(currentTrack),
        voiceChannel: player.voiceChannelId,
        textChannel: player.textChannelId
    };

    if (currentTrack?.userData?.originalSpotify) {
        status.spotifyInfo = {
            originalTitle: currentTrack.userData.originalSpotify.title,
            originalArtist: currentTrack.userData.originalSpotify.artist,
            spotifyId: currentTrack.userData.originalSpotify.spotifyId,
            isrc: currentTrack.userData.originalSpotify.isrc
        };
    }

    return status;
}

function buildQueueList(player) {
    const current = player.queue.current;
    const upcoming = player.queue.tracks.slice(0, MAX_LIST_COUNT);

    const currentTitle = safeGetTitle(current);
    const currentDuration = current?.info?.duration || current?.duration || 0;

    let queueList = `**Now Playing:** ${currentTitle} - \`${formatDuration(currentDuration)}\``;

    if (current?.userData?.originalSpotify) {
        queueList += `\n*Originally from Spotify: ${current.userData.originalSpotify.title} by ${current.userData.originalSpotify.artist}*`;
    }

    if (upcoming.length > 0) {
        const upNext = upcoming
            .map((song, i) => {
                const title = safeGetTitle(song);
                const duration = song?.info?.duration || song?.duration || 0;
                let trackInfo = `${i + 1}. ${title} - \`${formatDuration(duration)}\``;
                if (song?.userData?.originalSpotify) {
                    trackInfo += ' (Spotify)';
                }
                return trackInfo;
            })
            .join('\n');

        queueList += `\n\n**Up Next:**\n${upNext}`;
    }

    return queueList;
}

async function setRepeatModeAndNotify(player, mode, channel) {
    await player.setRepeatMode(mode);
    if (mode === REPEAT_MODES.TRACK) {
        return sendMessage(channel, 'Loop enabled: The current song will repeat.');
    }
    if (mode === REPEAT_MODES.QUEUE) {
        return sendMessage(channel, 'Queue loop enabled: The entire queue will repeat.');
    }
    return sendMessage(channel, 'Loop disabled.');
}

async function handleMessage(message) {
    if (message.author.bot || !message.guild) return;

    if (!message.content.startsWith(COMMAND_PREFIX)) return;

    const manager = message.client.manager;
    if (!manager || !manager.useable) {
        return sendMessage(message.channel, 'Lavalink is not ready yet, please wait a moment.');
    }

    const {command, args} = parseCommandArgs(message.content);

    const registry = new Map();

    registry.set('play', async () => {
        await playMusic(message, args.join(' '));
    });

    registry.set('status', async () => {
        const player = getPlayer(manager, message.guild.id);
        if (!player) {
            return sendMessage(message.channel, 'No player found for this guild.');
        }
        const status = buildStatusPayload(player);
        sendMessage(message.channel, `**Player Status:**\n\`\`\`json\n${JSON.stringify(status, null, 2)}\n\`\`\``);
    });

    registry.set('gabriel', async () => {
        sendMessage(
            message.channel,
            'Gabriel del Mundo dos Santos Alveira Pedro Sales Hectorus Las Vegas Official'
        );
    });

    registry.set('stop', async () => {
        const player = getPlayer(manager, message.guild.id);
        if (player) {
            player.destroy();
            sendMessage(message.channel, 'Stopped the music and left the channel.');
        } else {
            sendMessage(message.channel, 'Nothing is playing right now.');
        }
    });

    registry.set('skip', async () => {
        const player = getPlayer(manager, message.guild.id);
        if (player && player.queue.current) {
            if (player.queue.tracks.length === 0) {
                sendMessage(
                    message.channel,
                    "Can't skip - this is the only song in the queue! Use `.stop` to stop playback."
                );
                return;
            }
            const title = safeGetTitle(player.queue.current);
            player.skip();
            sendMessage(message.channel, `Skipped: **${title}**`);
        } else {
            sendMessage(message.channel, 'Nothing is playing right now.');
        }
    });

    registry.set('pause', async () => {
        const player = getPlayer(manager, message.guild.id);
        if (player && player.queue.current) {
            if (player.paused) {
                sendMessage(message.channel, 'The music is already paused!');
            } else {
                player.pause(true);
                sendMessage(message.channel, 'Paused the music!');
            }
        } else {
            sendMessage(message.channel, 'Nothing is playing right now.');
        }
    });

    registry.set('resume', async () => {
        const player = getPlayer(manager, message.guild.id);
        if (player && player.queue.current) {
            if (player.paused) {
                player.pause(false);
                sendMessage(message.channel, 'Resumed the music!');
            } else {
                sendMessage(message.channel, 'The music is already playing!');
            }
        } else {
            sendMessage(message.channel, 'Nothing is playing right now.');
        }
    });

    registry.set('queue', async () => {
        const player = getPlayer(manager, message.guild.id);
        if (!player || (!player.queue.current && player.queue.tracks.length === 0)) {
            return sendMessage(message.channel, 'The queue is empty.');
        }
        const queueList = buildQueueList(player);
        sendMessage(message.channel, `**Queue:**\n${queueList}`);
    });

    registry.set('loop', async () => {
        const player = getPlayer(manager, message.guild.id);
        if (!player) return sendMessage(message.channel, 'Nothing is playing right now.');
        const next = player.repeatMode === REPEAT_MODES.TRACK ? REPEAT_MODES.OFF : REPEAT_MODES.TRACK;
        await setRepeatModeAndNotify(player, next, message.channel);
    });

    registry.set('loopqueue', async () => {
        const player = getPlayer(manager, message.guild.id);
        if (!player) return sendMessage(message.channel, 'Nothing is playing right now.');
        const next = player.repeatMode === REPEAT_MODES.QUEUE ? REPEAT_MODES.OFF : REPEAT_MODES.QUEUE;
        await setRepeatModeAndNotify(player, next, message.channel);
    });

    registry.set('shuffle', async () => {
        const player = getPlayer(manager, message.guild.id);
        if (!player || player.queue.tracks.length < 2) {
            return sendMessage(message.channel, 'Not enough songs in queue to shuffle.');
        }
        player.queue.shuffle();
        sendMessage(message.channel, 'Queue shuffled!');
    });

    registry.set('volume', async () => {
        const player = getPlayer(manager, message.guild.id);
        if (!player) return sendMessage(message.channel, 'Nothing is playing right now.');

        const volume = parseInt(args[0], 10);
        if (isNaN(volume) || volume < 0 || volume > 150) {
            return sendMessage(
                message.channel,
                `Current volume: **${player.volume}%**\nUsage: \`.volume <0-150>\``
            );
        }
        await player.setVolume(volume);
        sendMessage(message.channel, `Volume set to **${volume}%**`);
    });

    registry.set('nowplaying', async () => {
        const player = getPlayer(manager, message.guild.id);
        if (!player || !player.queue.current) {
            return sendMessage(message.channel, 'Nothing is playing right now.');
        }

        const current = player.queue.current;
        const title = current.info?.title || current.title || 'Unknown Title';
        const author = current.info?.author || 'Unknown Artist';
        const duration = current.info?.duration || current.duration || 0;
        const requester = current.requester?.tag || current.requester?.username || 'Unknown User';
        const loopStatus =
            player.repeatMode === REPEAT_MODES.TRACK
                ? 'Track'
                : player.repeatMode === REPEAT_MODES.QUEUE
                    ? 'Queue'
                    : 'Off';

        let nowPlayingMessage =
            `🎵 **Now Playing:**\n` +
            `**${title}** by ${author}\n` +
            `👤 Requested by: ${requester}\n` +
            `⏱️ ${formatDuration(player.position)} / ${formatDuration(duration)}\n` +
            `🔊 Volume: ${player.volume}%\n` +
            `🔁 Loop: ${loopStatus}`;

        if (current.userData?.originalSpotify) {
            const spotify = current.userData.originalSpotify;
            nowPlayingMessage += `\n\n🎵 **Spotify Info:**\nOriginal: **${spotify.title}** by ${spotify.artist}`;
            if (spotify.album) nowPlayingMessage += `\nAlbum: ${spotify.album}`;
            if (spotify.isrc) nowPlayingMessage += `\nISRC: ${spotify.isrc}`;
        }

        sendMessage(message.channel, nowPlayingMessage);
    });

    registry.set('alt', async () => {
        const {handleAlternativeSearch} = require('./alternativeSearch');
        await handleAlternativeSearch(message, args);
    });

    registry.set('playalt', async () => {
        const {handlePlayAlternative} = require('./alternativeSearch');
        await handlePlayAlternative(message, args);
    });

    registry.set('help', async () => {
        const helpMessage = `**🎵 Music Bot Commands: **
    
**Basic Commands:**
\`.play <query/url>\` - Play from YouTube or Spotify
\`.pause\` - Pause the playback
\`.resume\` - Resume playback
\`.skip\` - Skip current track
\`.stop\` - Stop and disconnect
\`.queue\` - Show current queue
\`.nowplaying\` / \`.np\` - Show current track info

**Queue Management:**
\`.shuffle\` - Shuffle the queue
\`.loop\` - Toggle current track loop (off ↔ track)
\`.loopqueue\` / \`.lq\` - Toggle queue loop (off ↔ queue)
\`.volume <0-150>\` - Set playback volume

**Alternative Search:**
\`.alt <song>\` - Find alternative versions
\`.playalt <number>\` - Play alternative from list

**Utility:**
\`.status\` - Show detailed player status

**Supported Sources: **
• YouTube (direct links, searches)
• Spotify (tracks, playlists, albums)
• Auto-conversion: Spotify metadata → YouTube playback`;
        sendMessage(message.channel, helpMessage);
    });

    // Aliases
    registry.set('p', registry.get('play'));
    registry.set('lq', registry.get('loopqueue'));
    registry.set('np', registry.get('nowplaying'));

    const handler = registry.get(command);
    if (handler) {
        await handler();
    }
}

module.exports = {handleMessage};

