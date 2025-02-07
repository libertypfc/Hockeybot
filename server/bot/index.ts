import { Client, GatewayIntentBits, Events, Collection, SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { registerCommands } from './commands/index';

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, {
      data: SlashCommandBuilder,
      execute: (interaction: ChatInputCommandInteraction) => Promise<void>
    }>;
  }
}

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

// Set up basic event handlers
client.once(Events.ClientReady, async () => {
  console.log(`Discord bot is ready! Logged in as ${client.user?.tag}`);
  try {
    await registerCommands(client);
    console.log('Commands registered successfully');
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
});

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});

function parseDiscordToken(token: string): string {
  // If token starts with "Bot ", remove it
  if (token.startsWith('Bot ')) {
    return token.substring(4);
  }
  return token;
}

export async function startBot(): Promise<Client> {
  try {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      throw new Error('DISCORD_TOKEN environment variable is not set');
    }

    console.log('Starting Discord bot...');

    // Clear any existing listeners to prevent duplicates
    client.removeAllListeners();

    // Re-attach our event handlers
    client.once(Events.ClientReady, async () => {
      console.log(`Discord bot is ready! Logged in as ${client.user?.tag}`);
      try {
        await registerCommands(client);
        console.log('Commands registered successfully');
      } catch (error) {
        console.error('Failed to register commands:', error);
      }
    });

    client.on(Events.Error, (error) => {
      console.error('Discord client error:', error);
    });

    // Parse and use the token
    const parsedToken = parseDiscordToken(token);
    await client.login(parsedToken);
    console.log('Discord bot login successful');
    return client;
  } catch (error) {
    console.error('Failed to start Discord bot:', error);
    throw error;
  }
}