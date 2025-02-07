import { Client, Collection, REST, Routes, SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { TeamCommands } from './team';
import { ContractCommands } from './contract';
import { WaiversCommands } from './waivers';
import { TradeCommands } from './trade';
import { DatabaseCommands } from './database';
import { AdminCommands } from './admin';
import { SeasonCommands } from './season';
import { OrganizationCommands } from './organization';

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
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error('Discord token not found');
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('Started refreshing application (/) commands.');

    // Create a new Collection for commands
    client.commands = new Collection();

    // Collect valid commands
    const validCommands = new Map<string, any>();

    // Process each command module
    for (const [moduleName, moduleCommands] of Object.entries(CommandModules)) {
      if (!Array.isArray(moduleCommands)) {
        console.warn(`Invalid module ${moduleName}, skipping...`);
        continue;
      }

      for (const command of moduleCommands) {
        if (!command?.data?.name || !command.execute) {
          console.warn(`Invalid command in ${moduleName}, skipping...`);
          continue;
        }

        const commandName = command.data.name;
        validCommands.set(commandName, command);
        client.commands.set(commandName, command);
      }
    }

    // Convert commands to JSON
    const commandData = Array.from(validCommands.values()).map(cmd => cmd.data.toJSON());
    console.log(`Prepared ${commandData.length} commands for registration`);

    // Delete all existing commands
    console.log(`Deleting existing commands for application ${client.user.id}`);
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [] }
    );

    // Wait for deletion to propagate
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Register new commands
    console.log(`Registering ${commandData.length} commands for application ${client.user.id}`);
    const data = await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commandData }
    );

    console.log('Successfully registered application (/) commands.');
    console.log('Registration response:', data);

    hasRegisteredGlobally = true;
    return true;

  } catch (error) {
    console.error('Error in command registration:', error);
    hasRegisteredGlobally = false;
    throw error;
  }
}