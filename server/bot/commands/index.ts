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

  console.log('Starting command registration process...');

  // Create a REST instance for API calls
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

  try {
    // Get all guilds the bot is in
    const guilds = Array.from(client.guilds.cache.values());
    if (guilds.length === 0) {
      throw new Error('Bot is not in any guilds');
    }

    console.log(`Bot is in ${guilds.length} guilds`);

    // Create a new Collection for commands
    client.commands = new Collection();

    // Process and validate commands
    const uniqueCommands = new Map<string, any>();
    const processedNames = new Set<string>();

    // Process each command module
    for (const [moduleName, moduleCommands] of Object.entries(CommandModules)) {
      if (!Array.isArray(moduleCommands)) {
        console.warn(`Invalid module ${moduleName}, skipping...`);
        continue;
      }

      console.log(`Processing ${moduleName}...`);

      for (const command of moduleCommands) {
        if (!command.data?.name || !(command.data instanceof SlashCommandBuilder)) {
          console.warn(`Invalid command structure in ${moduleName}, skipping...`);
          continue;
        }

        const commandName = command.data.name;

        // Skip if we've already processed this command name
        if (processedNames.has(commandName)) {
          console.warn(`Duplicate command name '${commandName}' in ${moduleName}, skipping...`);
          continue;
        }

        // Add to our tracking collections
        processedNames.add(commandName);
        uniqueCommands.set(commandName, command);
        console.log(`Registered command: ${commandName} from ${moduleName}`);
      }
    }

    // Convert commands to Discord API format
    const commandData = Array.from(uniqueCommands.values()).map(cmd => cmd.data.toJSON());
    console.log(`Prepared ${commandData.length} unique commands for registration`);

    // Clear and register commands for each guild
    for (const guild of guilds) {
      console.log(`Processing guild: ${guild.id}`);

      try {
        // First, remove all existing commands from this guild
        console.log(`Clearing existing commands from guild ${guild.id}`);
        await rest.put(
          Routes.applicationGuildCommands(client.user.id, guild.id),
          { body: [] }
        );

        // Then register the new commands
        console.log(`Registering ${commandData.length} commands to guild ${guild.id}`);
        await rest.put(
          Routes.applicationGuildCommands(client.user.id, guild.id),
          { body: commandData }
        );

        console.log(`Successfully registered commands in guild ${guild.id}`);
      } catch (error) {
        console.error(`Error processing guild ${guild.id}:`, error);
        // Continue with other guilds even if one fails
        continue;
      }
    }

    // Set up the client.commands Collection
    for (const [name, command] of uniqueCommands) {
      client.commands.set(name, command);
    }

    console.log(`Successfully registered ${uniqueCommands.size} unique commands across all guilds`);
    return true;
  } catch (error) {
    console.error('Error in command registration:', error);
    throw error;
  }
}