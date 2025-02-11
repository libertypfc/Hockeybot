import { Client, GatewayIntentBits, Events, Collection, SlashCommandBuilder, ChatInputCommandInteraction, Partials, REST, Routes } from 'discord.js';
import { registerCommands } from './commands/index';
import { handleContractReactions } from './interactions/contractReactions';
import { db } from '@db';
import { teams, players, contracts, waivers } from '@db/schema';
import { eq } from 'drizzle-orm';

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

let connectionPromise: Promise<Client> | null = null;

export async function startBot(): Promise<Client> {
  // If we're already connecting, return the existing promise
  if (connectionPromise) {
    return connectionPromise;
  }

  // Create a new connection promise
  connectionPromise = (async () => {
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
        client.connectionState = 'connected';
        try {
          await registerCommands(client);
          console.log('Commands registered successfully');
        } catch (error) {
          console.error('Failed to register commands:', error);
        }
      });

      // Add reaction handlers
      client.on(Events.MessageReactionAdd, async (reaction, user) => {
        try {
          if (user.bot) return;
          if (reaction.partial) {
            try {
              await reaction.fetch();
            } catch (error) {
              console.error('Error fetching partial reaction:', error);
              return;
            }
          }
          await handleContractReactions(reaction, user);
        } catch (error) {
          console.error('Error handling reaction:', error);
        }
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

      // Add guild join handler
      client.on(Events.GuildCreate, async (guild) => {
        console.log(`Joined new guild: ${guild.name} (${guild.id})`);
        try {
          // Check if guild already has data
          const existingTeams = await db.query.teams.findMany({
            where: eq(teams.guildId, guild.id)
          });

          if (existingTeams.length === 0) {
            console.log(`Initializing database for new guild: ${guild.name}`);

            // Clear any existing data for this guild
            const guildId = guild.id;
            await Promise.all([
              db.delete(contracts).where(eq(contracts.guildId, guildId)),
              db.delete(waivers).where(eq(waivers.guildId, guildId)),
              db.delete(players).where(eq(players.guildId, guildId)),
              db.delete(teams).where(eq(teams.guildId, guildId))
            ]);
          }

          // Register slash commands for the new guild
          try {
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
            const commands = Array.from(client.commands.values()).map(cmd => cmd.data.toJSON());

            await rest.put(
              Routes.applicationGuildCommands(client.user!.id, guild.id),
              { body: commands }
            );

            console.log(`Successfully registered commands for new guild: ${guild.name}`);
          } catch (error) {
            console.error(`Failed to register commands for guild ${guild.name}:`, error);
          }
        } catch (error) {
          console.error(`Error initializing database for guild ${guild.name}:`, error);
        }
      });

      client.on(Events.Error, (error) => {
        console.error('Discord client error:', error);
        client.connectionState = 'error';
        connectionPromise = null; // Allow reconnection attempts
      });

      // Login with token
      await client.login(token);
      return client;

    } catch (error) {
      console.error('Failed to start Discord bot:', error);
      client.connectionState = 'error';
      connectionPromise = null; // Allow reconnection attempts
      throw error;
    }
  })();

  return connectionPromise;
}

// Handle process termination
process.on('SIGTERM', () => {
  console.log('Received SIGTERM signal, cleaning up...');
  client.connectionState = 'disconnected';
  client.destroy();
  connectionPromise = null;
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT signal, cleaning up...');
  client.connectionState = 'disconnected';
  client.destroy();
  connectionPromise = null;
  process.exit(0);
});