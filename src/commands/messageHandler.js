const {sendMessage, formatDuration} = require('../utils/helpers');
const {playMusic} = require('./musicCommands');

const COMMAND_PREFIX = '.';
const MAX_LIST_COUNT = 10;
const REPEAT_MODES = {OFF: 'off', TRACK: 'track', QUEUE: 'queue'};
const STATE_CMD_COOLDOWN_MS = 750;

const guildLocks = new Map();

function withGuildLock(guildId, task) {
    const prev = guildLocks.get(guildId) || Promise.resolve();
    const next = prev
        .catch(() => {
        })
        .then(() => task())
        .finally(() => {
            if (guildLocks.get(guildId) === next) guildLocks.delete(guildId);
        });
    guildLocks.set(guildId, next);
    return next;
}

// Per-guild per-command cooldowns
const guildCooldowns = new Map();

function isOnCooldown(guildId, command) {
    const cmdMap = guildCooldowns.get(guildId);
    if (!cmdMap) return false;
    const until = cmdMap.get(command) || 0;
    return Date.now() < until;
}

function setCooldown(guildId, command, ms = STATE_CMD_COOLDOWN_MS) {
    let cmdMap = guildCooldowns.get(guildId);
    if (!cmdMap) {
        cmdMap = new Map();
        guildCooldowns.set(guildId, cmdMap);
    }
    cmdMap.set(command, Date.now() + ms);
}

function ensurePlayerReady(player) {
    // Basic readiness checks to avoid issuing commands during disconnects/desyncs
    if (!player) return {ok: false, reason: 'No player found for this guild.'};
    if (!player.connected) return {ok: false, reason: 'Bot is not connected to voice.'};
    if (!player.voiceChannelId) return {ok: false, reason: 'No voice channel is set for the player.'};
    //if (message.member.voice.channelId !== player.voiceChannelId)
    return {ok: true};
}

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
        const guildId = message.guild.id;
        const player = getPlayer(manager, guildId);

        await withGuildLock(guildId, async () => {
            if (!player) {
                return sendMessage(message.channel, 'Nothing is playing right now.');
            }
            if (isOnCooldown(guildId, 'stop')) {
                return sendMessage(message.channel, 'Please wait a moment before stopping again.');
            }
            setCooldown(guildId, 'stop');

            try {
                player.destroy();
                sendMessage(message.channel, 'Stopped the music and left the channel.');
            } catch (err) {
                console.error('[Music][stop] failed', {
                    guildId,
                    connected: player?.connected,
                    paused: player?.paused,
                    playing: player?.playing,
                    voiceChannelId: player?.voiceChannelId
                }, err);
                sendMessage(message.channel, `Could not stop: ${err?.message || err}`);
            }
        });
    });

    registry.set('skip', async () => {
        const guildId = message.guild.id;
        const player = getPlayer(manager, guildId);

        await withGuildLock(guildId, async () => {
            const ready = ensurePlayerReady(player);
            if (!ready.ok) return sendMessage(message.channel, ready.reason);

            if (!player?.queue?.current) {
                return sendMessage(message.channel, 'Nothing is playing right now.');
            }
            if (player.queue.tracks.length === 0) {
                return sendMessage(
                    message.channel,
                    "Can't skip - this is the only song in the queue! Use `.stop` to stop playback."
                );
            }
            if (isOnCooldown(guildId, 'skip')) {
                return sendMessage(message.channel, 'Please wait a moment before skipping again.');
            }
            setCooldown(guildId, 'skip');

            const title = safeGetTitle(player.queue.current);
            try {
                player.skip();
                sendMessage(message.channel, `Skipped: **${title}**`);
            } catch (err) {
                console.error('[Music][skip] failed', {
                    guildId,
                    connected: player?.connected,
                    paused: player?.paused,
                    playing: player?.playing,
                    voiceChannelId: player?.voiceChannelId
                }, err);
                sendMessage(message.channel, `Could not skip: ${err?.message || err}`);
            }
        });
    });

    registry.set('pause', async () => {
        const guildId = message.guild.id;
        const player = getPlayer(manager, guildId);

        // Serialize and protect this section
        await withGuildLock(guildId, async () => {
            const ready = ensurePlayerReady(player);
            if (!ready.ok) return sendMessage(message.channel, ready.reason);

            if (!player?.queue?.current) {
                return sendMessage(message.channel, 'Nothing is playing right now.');
            }
            if (player.paused) {
                return sendMessage(message.channel, 'The music is already paused!');
            }
            if (isOnCooldown(guildId, 'pause')) {
                return sendMessage(message.channel, 'Please wait a moment before pausing again.');
            }
            setCooldown(guildId, 'pause');

            try {
                await player.pause();
                sendMessage(message.channel, 'Paused the music!');
            } catch (err) {
                console.error('[Music][pause] failed', {
                    guildId,
                    connected: player?.connected,
                    paused: player?.paused,
                    playing: player?.playing,
                    voiceChannelId: player?.voiceChannelId
                }, err);
                sendMessage(message.channel, `Could not pause: ${err?.message || err}`);
            }
        });
    });

    registry.set('resume', async () => {
        const guildId = message.guild.id;
        const player = getPlayer(manager, guildId);

        await withGuildLock(guildId, async () => {
            const ready = ensurePlayerReady(player);
            if (!ready.ok) return sendMessage(message.channel, ready.reason);

            if (!player?.queue?.current) {
                return sendMessage(message.channel, 'Nothing is playing right now.');
            }
            if (!player.paused) {
                return sendMessage(message.channel, 'The music is already playing!');
            }
            if (isOnCooldown(guildId, 'resume')) {
                return sendMessage(message.channel, 'Please wait a moment before resuming again.');
            }
            setCooldown(guildId, 'resume');

            try {
                await player.resume();
                sendMessage(message.channel, 'Resumed the music!');
            } catch (err) {
                console.error('[Music][resume] failed', {
                    guildId,
                    connected: player?.connected,
                    paused: player?.paused,
                    playing: player?.playing,
                    voiceChannelId: player?.voiceChannelId
                }, err);
                sendMessage(message.channel, `Could not resume: ${err?.message || err}`);
            }
        });
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

