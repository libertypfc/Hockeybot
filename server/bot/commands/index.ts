import { Client, Collection, REST, Routes, SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { TeamCommands } from './team';
import { ContractCommands } from './contract';
import { WaiversCommands } from './waivers';
import { TradeCommands } from './trade';
import { DatabaseCommands } from './database';
import { AdminCommands } from './admin';
import { SeasonCommands } from './season';
import { OrganizationCommands } from './organization';

// Export all command modules for use in the bot
export const CommandModules = {
  TeamCommands,
  ContractCommands,
  WaiversCommands,
  TradeCommands,
  DatabaseCommands,
  AdminCommands,
  SeasonCommands,
  OrganizationCommands,
};

export async function registerCommands(client: Client) {
  if (!client.user) {
    throw new Error('Client user is not available');
  }

  // Clear any existing commands
  client.commands = new Collection();

  console.log('Starting command registration process...');

  // Create a Set to track unique command names across all modules
  const uniqueCommandNames = new Set<string>();

  // Process all command modules
  const commandModules = [
    { name: 'Team', commands: TeamCommands },
    { name: 'Contract', commands: ContractCommands },
    { name: 'Waivers', commands: WaiversCommands },
    { name: 'Trade', commands: TradeCommands },
    { name: 'Database', commands: DatabaseCommands },
    { name: 'Admin', commands: AdminCommands },
    { name: 'Season', commands: SeasonCommands },
    { name: 'Organization', commands: OrganizationCommands },
  ];

  // Collect all valid commands
  const validCommands = new Map<string, any>();

  // Register commands from each module
  for (const module of commandModules) {
    console.log(`Processing ${module.name} commands...`);
    if (!Array.isArray(module.commands)) {
      console.warn(`Invalid command module: ${module.name}, skipping...`);
      continue;
    }

    // Filter out invalid commands and duplicates
    for (const command of module.commands) {
      if (!command.data?.name) continue;

      // Skip if command is already registered
      if (validCommands.has(command.data.name)) {
        console.warn(`Duplicate command '${command.data.name}' found, skipping...`);
        continue;
      }

      // Validate command structure
      if (!(command.data instanceof SlashCommandBuilder)) {
        console.warn(`Invalid command structure for '${command.data.name}', skipping...`);
        continue;
      }

      // Add to valid commands
      validCommands.set(command.data.name, command);
      console.log(`Registered command: ${command.data.name} from ${module.name}`);
    }
  }

  // Register commands with Discord API
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

  try {
    console.log('Started refreshing application (/) commands.');

    // Get all guilds the bot is in
    const guilds = Array.from(client.guilds.cache.values());
    console.log(`Bot is in ${guilds.length} guilds`);

    if (guilds.length === 0) {
      throw new Error('Bot is not in any guilds. Please add the bot to a server first.');
    }

    // Prepare command data
    const commandData = Array.from(validCommands.values()).map(cmd => cmd.data.toJSON());

    // Register commands for each guild
    for (const guild of guilds) {
      console.log(`Registering ${commandData.length} commands for guild: ${guild.id}`);

      // First, remove all existing commands from this guild
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, guild.id),
        { body: [] }
      );

      // Then register the new commands
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, guild.id),
        { body: commandData }
      );

      console.log(`Successfully registered commands in guild ${guild.id}`);
    }

    // Set commands in client.commands Collection
    for (const [name, command] of validCommands) {
      client.commands.set(name, command);
    }

    console.log('Successfully registered application (/) commands in all guilds.');
  } catch (error) {
    console.error('Error registering commands:', error);
    throw error;
  }
}