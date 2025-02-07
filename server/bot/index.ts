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

function cleanToken(token: string): string {
  // If token already starts with MTM, return as is
  if (token.startsWith('MTM')) {
    return token;
  }
  // Remove any whitespace and 'Bot ' prefix if present
  const cleanedToken = token.trim().replace(/^Bot\s+/i, '');

  // Basic validation of token format (should contain two dots)
  if (!cleanedToken.includes('.') || cleanedToken.split('.').length !== 3) {
    throw new Error('Invalid token format - should be in the format xxx.yyy.zzz');
  }

  return cleanedToken;
}

async function attemptConnection(token: string): Promise<boolean> {
  try {
    client.connectionState = 'connecting';
    console.log('Attempting Discord bot connection...');

    // Add debug logging for token format
    const tokenDebugInfo = {
      length: token.length,
      containsDots: token.includes('.'),
      sections: token.split('.').length,
      hasPrefix: token.startsWith('Bot '),
      // Add segment lengths without revealing token content
      segmentLengths: token.split('.').map(segment => segment.length)
    };
    console.log('Token format check:', tokenDebugInfo);

    await client.login(token);
    client.connectionState = 'connected';
    console.log('Discord bot login successful');
    return true;
  } catch (error) {
    client.connectionState = 'error';
    console.error('Connection attempt failed:', error);
    if (error instanceof Error) {
      // Add detailed error analysis
      const errorDetails = {
        name: error.name,
        message: error.message,
        code: (error as any).code,
        type: error.constructor.name
      };
      console.error('Error details:', errorDetails);
    }
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

      // Try different token formats with MTM format first
      const connectionAttempts = [
        { format: 'mtm-raw', token: token },  // Use token as is since it's already MTM
        { format: 'cleaned', token: cleanToken(token) }
      ];

      for (const attempt of connectionAttempts) {
        console.log(`Attempting connection with ${attempt.format} token format...`);
        if (await attemptConnection(attempt.token)) {
          return client;
        }
        // Add delay between attempts
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      throw new Error('Failed to connect with all token formats');

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