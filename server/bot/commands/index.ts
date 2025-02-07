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

    // First, clear global commands
    console.log('Clearing global application commands...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [] }
    );

    // Wait a moment to ensure commands are cleared
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Register commands globally
    console.log(`Registering ${commandData.length} commands globally...`);
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commandData }
    );

    // Set up the client.commands Collection
    for (const [name, command] of uniqueCommands) {
      client.commands.set(name, command);
    }

    console.log(`Successfully registered ${uniqueCommands.size} unique commands globally`);
    return true;
  } catch (error) {
    console.error('Error in command registration:', error);
    throw error;
  }
}