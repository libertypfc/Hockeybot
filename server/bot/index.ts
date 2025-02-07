import { Client, GatewayIntentBits, Events, Collection, SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { registerCommands } from './commands/index';

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, {
      data: SlashCommandBuilder,
      execute: (interaction: ChatInputCommandInteraction) => Promise<void>
    }>;
    connectionState?: 'connecting' | 'connected' | 'disconnected' | 'error';
  }
}

// Create a singleton client instance
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();
client.connectionState = 'disconnected';


async function attemptConnection(token: string): Promise<boolean> {
  try {
    client.connectionState = 'connecting';
    console.log('Attempting Discord bot connection...');

    await client.login(token);
    client.connectionState = 'connected';
    console.log('Discord bot login successful');
    return true;
  } catch (error) {
    client.connectionState = 'error';
    console.error('Connection attempt failed:', error);
    return false;
  }
}

export async function startBot(): Promise<Client> {
  try {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      throw new Error('DISCORD_TOKEN environment variable is not set');
    }

    console.log('Starting Discord bot initialization...');

    try {
      // Clear any existing listeners to prevent duplicates
      client.removeAllListeners();

      // Set up event handlers
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
        client.connectionState = 'error';
        console.error('Discord client error:', error);
      });

      // Simple connection attempt
      if (await attemptConnection(token)) {
        return client;
      }

      throw new Error('Failed to connect to Discord');

    } catch (error) {
      client.connectionState = 'error';
      if (error instanceof Error) {
        console.error('Bot initialization error:', {
          message: error.message,
          name: error.name,
          stack: error.stack
        });
      }
      throw error;
    }
  } catch (error) {
    console.error('Failed to start Discord bot:', error);
    throw error;
  }
}

// Handle process termination
process.on('SIGTERM', () => {
  console.log('Received SIGTERM signal, cleaning up...');
  client.connectionState = 'disconnected';
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT signal, cleaning up...');
  client.connectionState = 'disconnected';
  client.destroy();
  process.exit(0);
});