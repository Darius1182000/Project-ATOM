const {LavalinkManager} = require('lavalink-client');

function initializeLavalink(client, envVars) {
    return new LavalinkManager({
        nodes: [
            {
                id: 'main-node',
                host: envVars.LAVALINK_HOST,
                port: Number.parseInt(envVars.LAVALINK_PORT, 10),
                authorization: envVars.LAVALINK_PASSWORD,
                secure: String(envVars.LAVALINK_SECURE || '').toLowerCase() === 'true',
                retryAmount: 5,
                retryDelay: 10000
            }
        ],
        sendToShard: (guildId, payload) => {
            const guild = client.guilds.cache.get(guildId);
            if (guild) guild.shard.send(payload);
        },
        client: {
            // Many Lavalink clients allow a placeholder here and acquire the ID on init(client.user)
            id: 'PLACEHOLDER'
        },
        playerOptions: {
            clientBasedPositionUpdate: true,
            defaultSearchPlatform: 'ytsearch',
            volume: 75
        },
        queueOptions: {
            maxPreviousTracks: 25
        }
    });
}

module.exports = {initializeLavalink};
