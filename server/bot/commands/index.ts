import { Client, Collection, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { TeamCommands } from './team';
import { ContractCommands } from './contract';
import { WaiversCommands } from './waivers';
import { TradeCommands } from './trade';
import { DatabaseCommands } from './database';
import { AdminCommands } from './admin';
import { SeasonCommands } from './season';
import { OrganizationCommands } from './organization';

const registeredCommands = new Set<string>();

export async function registerCommands(client: Client) {
  if (!client.user) {
    throw new Error('Client user is not available');
  }

  // Clear existing commands
  client.commands = new Collection();

  // Combine all command modules
  const commands = [
    ...TeamCommands,
    ...ContractCommands,
    ...WaiversCommands,
    ...TradeCommands,
    ...DatabaseCommands,
    ...AdminCommands,
    ...SeasonCommands,
    ...OrganizationCommands,
  ];

  console.log(`Processing ${commands.length} commands for registration...`);

  // Register unique commands to the collection
  for (const command of commands) {
    if (!command.data || !(command.data instanceof SlashCommandBuilder)) {
      console.warn(`Skipping invalid command: ${command.data?.name || 'unknown'}`);
      continue;
    }

    const commandName = command.data.name;
    if (registeredCommands.has(commandName)) {
      console.warn(`Skipping duplicate command: ${commandName}`);
      continue;
    }

    console.log(`Adding command to collection: ${commandName}`);
    client.commands.set(commandName, command);
    registeredCommands.add(commandName);
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

    // Register commands for each guild
    for (const guild of guilds) {
      console.log(`Registering commands for guild: ${guild.id}`);

      const commandData = Array.from(client.commands.values())
        .filter(cmd => cmd.data instanceof SlashCommandBuilder)
        .map(command => command.data.toJSON());

      await rest.put(
        Routes.applicationGuildCommands(client.user.id, guild.id),
        { body: commandData },
      );

      console.log(`Successfully registered ${commandData.length} commands in guild ${guild.id}`);
    }

    console.log('Successfully registered application (/) commands in all guilds.');
  } catch (error) {
    console.error('Error registering commands:', error);
    throw error;
  }
}