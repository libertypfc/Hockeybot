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

    // First, clear ALL commands from each guild
    for (const guild of guilds) {
      try {
        console.log(`Clearing all commands from guild ${guild.id}...`);
        await rest.put(
          Routes.applicationGuildCommands(client.user.id, guild.id),
          { body: [] }
        );
        console.log(`Successfully cleared all commands from guild ${guild.id}`);
      } catch (error) {
        console.error(`Failed to clear commands from guild ${guild.id}:`, error);
      }
    }

    // Wait a moment to ensure commands are cleared
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Create a new Collection for commands
    client.commands = new Collection();

    // Collect and validate unique commands
    const uniqueCommands = new Map<string, any>();
    const registeredCommandNames = new Set<string>();

    // Process each command module
    for (const [moduleName, moduleCommands] of Object.entries(CommandModules)) {
      if (!Array.isArray(moduleCommands)) {
        console.warn(`Invalid module ${moduleName}, skipping...`);
        continue;
      }

      for (const command of moduleCommands) {
        if (!command.data?.name || !(command.data instanceof SlashCommandBuilder)) {
          console.warn(`Invalid command structure in ${moduleName}, skipping command`);
          continue;
        }

        const commandName = command.data.name;

        // Strict duplicate checking
        if (registeredCommandNames.has(commandName)) {
          console.warn(`Duplicate command name '${commandName}' in ${moduleName}, skipping...`);
          continue;
        }

        // Log each command being registered
        console.log(`Registering command: ${commandName} from ${moduleName}`);
        registeredCommandNames.add(commandName);
        uniqueCommands.set(commandName, command);
      }
    }

    // Convert commands to Discord API format
    const commandData = Array.from(uniqueCommands.values()).map(cmd => {
      const json = cmd.data.toJSON();
      console.log(`Prepared command for API: ${json.name}`);
      return json;
    });

    console.log(`Prepared ${commandData.length} unique commands for registration`);

    // Register commands to each guild
    for (const guild of guilds) {
      try {
        console.log(`Registering ${commandData.length} commands to guild ${guild.id}`);
        await rest.put(
          Routes.applicationGuildCommands(client.user.id, guild.id),
          { body: commandData }
        );
        console.log(`Successfully registered commands in guild ${guild.id}`);
      } catch (error) {
        console.error(`Error registering commands to guild ${guild.id}:`, error);
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