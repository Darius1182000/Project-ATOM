// --- ENVIRONMENT VALIDATION ---
function validateEnvironment() {
  const requiredEnvVars = {
    TOKEN: process.env.DISCORD_TOKEN,
    LAVALINK_HOST: process.env.LAVALINK_HOST || 'localhost',
    LAVALINK_PORT: process.env.LAVALINK_PORT || '2333',
    LAVALINK_PASSWORD: process.env.LAVALINK_PASSWORD || 'youshallnotpass'
  };

  if (!requiredEnvVars.TOKEN) {
    console.error('❌ Missing required environment variable: TOKEN');
    process.exit(1);
  }

  return requiredEnvVars;
}

module.exports = { validateEnvironment };
