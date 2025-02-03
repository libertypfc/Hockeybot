import { Client, Collection, REST, Routes } from 'discord.js';
import { TeamCommands } from './team';
import { ContractCommands } from './contract';
import { WaiversCommands } from './waivers';
import { TradeCommands } from './trade';
import { DatabaseCommands } from './database';
import { AdminCommands } from './admin';
import { GameCommands } from './game';

export async function registerCommands(client: Client) {
  if (!client.user) {
    throw new Error('Client user is not available');
  }

  client.commands = new Collection();

  // Register all command modules
  const commands = [
    ...TeamCommands,
    ...ContractCommands,
    ...WaiversCommands,
    ...TradeCommands,
    ...DatabaseCommands,
    ...AdminCommands,
    ...GameCommands,
  ];

  console.log(`Registering ${commands.length} commands...`);

  // Register commands to the collection
  for (const command of commands) {
    console.log(`Adding command to collection: ${command.data.name}`);
    client.commands.set(command.data.name, command);
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

    // Register commands for the first guild
    const guildId = guilds[0].id;
    console.log(`Registering commands for guild: ${guildId}`);

    const commandData = commands.map(command => command.data.toJSON());
    console.log(`Prepared ${commandData.length} commands for registration`);

    await rest.put(
      Routes.applicationGuildCommands(client.user.id, guildId),
      { body: commandData },
    );

    console.log('Successfully registered application (/) commands.');
  } catch (error) {
    console.error('Error registering commands:', error);
    throw error;
  }
}