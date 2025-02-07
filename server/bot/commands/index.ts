import { Client, Collection, REST, Routes, SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { TeamCommands } from './team';
import { ContractCommands } from './contract';
import { WaiversCommands } from './waivers';
import { TradeCommands } from './trade';
import { DatabaseCommands } from './database';
import { AdminCommands } from './admin';
import { SeasonCommands } from './season';
import { OrganizationCommands } from './organization';

// Track registered command names globally
const registeredCommands = new Map<string, {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}>();

function validateAndRegisterCommand(command: any) {
  if (!command.data || !(command.data instanceof SlashCommandBuilder)) {
    console.warn(`Skipping invalid command: ${command.data?.name || 'unknown'}`);
    return false;
  }

  const commandName = command.data.name;
  if (registeredCommands.has(commandName)) {
    console.warn(`Duplicate command found: ${commandName}, skipping...`);
    return false;
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

  // Create a Set to track unique command names
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

    for (const command of module.commands) {
      if (!command.data) continue;

      const commandName = command.data.name;
      if (uniqueCommandNames.has(commandName)) {
        console.warn(`Duplicate command '${commandName}' found in ${module.name} module, skipping...`);
        continue;
      }

      if (validateAndRegisterCommand(command)) {
        uniqueCommandNames.add(commandName);
        console.log(`Registered command: ${commandName}`);
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