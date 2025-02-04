import { Client, GatewayIntentBits, Events } from 'discord.js';
import { log } from '../vite';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

export async function startBot() {
  try {
    // Set up event handlers
    client.once(Events.ClientReady, c => {
      log(`Ready! Logged in as ${c.user.tag}`, 'discord');
      log(`Bot is in ${c.guilds.cache.size} guilds`, 'discord');
    });

    client.on(Events.Error, error => {
      log(`Discord client error: ${error.message}`, 'discord');
    });

    // Login with token
    await client.login(process.env.DISCORD_TOKEN);
    log('Bot successfully started and connected!', 'discord');

    return client;
  } catch (error) {
    log(`Failed to start Discord bot: ${error}`, 'discord');
    throw error;
  }
}

export default client;