const { LavalinkManager } = require('lavalink-client');

function initializeLavalink(client, envVars) {
  const manager = new LavalinkManager({
    nodes: [
      {
        id: 'main-node',
        host: envVars.LAVALINK_HOST,
        port: parseInt(envVars.LAVALINK_PORT),
        authorization: envVars.LAVALINK_PASSWORD,
        secure: false,
        retryAmount: 5,
        retryDelay: 10000
      }
    ],
    sendToShard: (guildId, payload) => {
      const guild = client.guilds.cache.get(guildId);
      if (guild) guild.shard.send(payload);
    },
    client: {
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

  return manager;
}

module.exports = { initializeLavalink };
