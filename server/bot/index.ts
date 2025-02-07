import { Client, GatewayIntentBits, Events, Collection, SlashCommandBuilder, ChatInputCommandInteraction, Partials } from 'discord.js';
import { registerCommands } from './commands/index';
import { handleContractReactions } from './interactions/contractReactions';

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
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.commands = new Collection();
client.connectionState = 'disconnected';

export async function startBot(): Promise<Client> {
  try {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      throw new Error('DISCORD_TOKEN environment variable is not set');
    }

    console.log('Starting Discord bot...');
    client.connectionState = 'connecting';

    // Clear any existing listeners to prevent duplicates
    client.removeAllListeners();

    // Set up event handlers
    client.once(Events.ClientReady, async (c) => {
      console.log(`Ready! Logged in as ${c.user.tag}`);
      try {
        await registerCommands(client);
        console.log('Commands registered successfully');
      } catch (error) {
        console.error('Failed to register commands:', error);
      }
    });

    // Add reaction handlers
    client.on(Events.MessageReactionAdd, async (reaction, user) => {
      if (user.bot) return; // Ignore bot reactions
      await handleContractReactions(reaction, user);
    });

    // Add interaction handler for slash commands
    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const command = client.commands.get(interaction.commandName);
      if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        await interaction.reply({
          content: 'This command is not available.',
          ephemeral: true
        });
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`Error executing ${interaction.commandName}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'An error occurred while executing this command.';

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: `There was an error executing this command: ${errorMessage}`,
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: `There was an error executing this command: ${errorMessage}`,
            ephemeral: true
          });
        }
      }
    });

    client.on(Events.Error, (error) => {
      console.error('Discord client error:', error);
      client.connectionState = 'error';
    });

    // Login with token
    await client.login(token);
    client.connectionState = 'connected';
    return client;

  } catch (error) {
    console.error('Failed to start Discord bot:', error);
    client.connectionState = 'error';
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