import { Client, Collection, REST, Routes } from 'discord.js';
import { TeamCommands } from './team';
import { ContractCommands } from './contract';
import { WaiversCommands } from './waivers';
import { TradeCommands } from './trade';

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
  ];

  console.log(`Registering ${commands.length} commands...`);

  commands.forEach(command => {
    console.log(`Registering command: ${command.data.name}`);
    client.commands.set(command.data.name, command);
  });

  // Register commands with Discord
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

  try {
    console.log('Started refreshing application (/) commands.');

    await rest.put(
      Routes.applicationGuildCommands(client.user.id, interaction?.guildId ?? ''),
      { body: commands.map(command => command.data.toJSON()) },
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering commands:', error);
    throw error;
  }
}