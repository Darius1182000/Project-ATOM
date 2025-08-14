require("dotenv").config();

const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// Replace with your bot token
const TOKEN = process.env.DISCORD_TOKEN;

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', (message) => {

        // Only respond if the author is you
    //if (message.author.id !== process.env.MY_USER_ID) return;

    if (message.content === '.gabriel') {
        message.reply('Gabriel del Mundo do Santos Alveira Pedro Sales Hectorus Las Vegas Official');
    }
});

client.login(TOKEN);
