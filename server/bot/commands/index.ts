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

// Track registered command names globally
const registeredCommands = new Map<string, {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}>();

function validateAndRegisterCommand(command: any, moduleName: string) {
  if (!command.data || !(command.data instanceof SlashCommandBuilder)) {
    console.warn(`Skipping invalid command in ${moduleName}: ${command.data?.name || 'unknown'}`);
    return false;
  }

  const commandName = command.data.name;
  if (registeredCommands.has(commandName)) {
    console.warn(`Duplicate command '${commandName}' found in ${moduleName}, skipping...`);
    return false;
  }

  // Additional validation for subcommands
  if (command.data.options?.some((opt: any) => opt.type === 1)) { // 1 is SUB_COMMAND type
    const subcommandNames = new Set<string>();
    for (const option of command.data.options) {
      if (option.type === 1) {
        if (subcommandNames.has(option.name)) {
          console.warn(`Duplicate subcommand '${option.name}' found in command '${commandName}', skipping entire command...`);
          return false;
        }
        subcommandNames.add(option.name);
      }
    }
  }

  registeredCommands.set(commandName, command);
  return true;
}

export async function registerCommands(client: Client) {
  if (!client.user) {
    throw new Error('Client user is not available');
  }

  // Clear any existing commands
  client.commands = new Collection();
  registeredCommands.clear();

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

  // Register commands from each module
  for (const module of commandModules) {
    console.log(`Processing ${module.name} commands...`);
    if (!Array.isArray(module.commands)) {
      console.warn(`Invalid command module: ${module.name}, skipping...`);
      continue;
    }

    // Filter out duplicate commands within the same module
    const moduleCommands = new Map<string, any>();
    for (const command of module.commands) {
      if (!command.data?.name) continue;

      if (moduleCommands.has(command.data.name)) {
        console.warn(`Duplicate command '${command.data.name}' found within ${module.name} module, keeping first instance...`);
        continue;
      }
      moduleCommands.set(command.data.name, command);
    }

    // Register filtered commands
    for (const [commandName, command] of moduleCommands) {
      if (uniqueCommandNames.has(commandName)) {
        console.warn(`Command '${commandName}' already registered by another module, skipping...`);
        continue;
      }

      if (validateAndRegisterCommand(command, module.name)) {
        uniqueCommandNames.add(commandName);
        console.log(`Registered command: ${commandName} from ${module.name}`);
      }
    }
  }

  // Convert registered commands to Collection for Discord.js
  for (const [name, command] of registeredCommands) {
    client.commands.set(name, command);
  }

  console.log(`Successfully processed ${registeredCommands.size} unique commands`);

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

    // Prepare command data once
    const commandData = Array.from(registeredCommands.values())
      .map(command => command.data.toJSON());

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

    console.log('Successfully registered application (/) commands in all guilds.');
  } catch (error) {
    console.error('Error registering commands:', error);
    throw error;
  }
}