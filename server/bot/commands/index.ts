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

let hasRegisteredGlobally = false;

export async function registerCommands(client: Client) {
  if (!client.user) {
    throw new Error('Client user is not available');
  }

  if (hasRegisteredGlobally) {
    console.log('Commands already registered globally, skipping...');
    return true;
  }

  console.log('Starting command registration process...');
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

  try {
    // Create a new Collection for commands
    client.commands = new Collection();

    // Collect and validate unique commands
    const uniqueCommands = new Map<string, any>();
    const registeredCommandNames = new Set<string>();
    const duplicateCommands = new Set<string>();

    // Process each command module
    for (const [moduleName, moduleCommands] of Object.entries(CommandModules)) {
      if (!Array.isArray(moduleCommands)) {
        console.warn(`Invalid module ${moduleName}, skipping...`);
        continue;
      }

      console.log(`Processing commands from module: ${moduleName}`);

      for (const command of moduleCommands) {
        // Validate command structure
        if (!command?.data?.name || !command.data.description || !(command.data instanceof SlashCommandBuilder)) {
          console.warn(`Invalid command structure in ${moduleName}, missing required properties`);
          continue;
        }

        if (typeof command.execute !== 'function') {
          console.warn(`Invalid command in ${moduleName}: missing execute function`);
          continue;
        }

        const commandName = command.data.name;

        // Track duplicates
        if (registeredCommandNames.has(commandName)) {
          duplicateCommands.add(commandName);
          console.warn(`Duplicate command name '${commandName}' found in ${moduleName}, skipping...`);
          continue;
        }

        // Register valid commands
        console.log(`Registering command: ${commandName} from ${moduleName}`);
        registeredCommandNames.add(commandName);
        uniqueCommands.set(commandName, command);

        // Set up the client.commands Collection immediately
        client.commands.set(commandName, command);
      }
    }

    // Log duplicate commands if any were found
    if (duplicateCommands.size > 0) {
      console.warn('Found duplicate commands:', Array.from(duplicateCommands));
    }

    // Convert commands to Discord API format with proper error handling
    const commandData = [];
    for (const cmd of uniqueCommands.values()) {
      try {
        const json = cmd.data.toJSON();
        console.log(`Prepared command for API: ${json.name}`);
        commandData.push(json);
      } catch (error) {
        console.error(`Failed to convert command ${cmd.data.name} to JSON:`, error);
      }
    }

    console.log(`Prepared ${commandData.length} unique commands for registration`);

    // Clear existing commands first with retry logic
    const maxRetries = 3;
    let retryCount = 0;
    let cleared = false;

    while (!cleared && retryCount < maxRetries) {
      try {
        console.log(`Attempt ${retryCount + 1} to clear existing commands...`);
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        cleared = true;
        console.log('Successfully cleared existing commands');
      } catch (error) {
        retryCount++;
        if (retryCount === maxRetries) {
          throw new Error(`Failed to clear commands after ${maxRetries} attempts`);
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    // Register new commands with retry logic
    retryCount = 0;
    let registered = false;

    while (!registered && retryCount < maxRetries) {
      try {
        console.log(`Attempt ${retryCount + 1} to register ${commandData.length} commands...`);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commandData });
        registered = true;
        console.log(`Successfully registered ${commandData.length} commands`);
      } catch (error) {
        retryCount++;
        if (retryCount === maxRetries) {
          throw new Error(`Failed to register commands after ${maxRetries} attempts`);
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    hasRegisteredGlobally = true;
    return true;

  } catch (error) {
    console.error('Error in command registration:', error);
    hasRegisteredGlobally = false; // Reset flag on error
    throw error;
  }
}