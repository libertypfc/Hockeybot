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

export async function registerCommands(client: Client) {
  if (!client.user) {
    throw new Error('Client user is not available');
  }

  console.log('Starting command registration...');

  const token = process.env.DISCORD_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token || !guildId) {
    throw new Error('Required environment variables not found');
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('Started refreshing application (/) commands.');

    // Create a new Collection for commands
    client.commands = new Collection();

    // Collect all commands from modules
    const commands = [];
    for (const [moduleName, moduleCommands] of Object.entries(CommandModules)) {
      if (Array.isArray(moduleCommands)) {
        for (const command of moduleCommands) {
          if (command?.data && command.execute) {
            commands.push(command.data.toJSON());
            client.commands.set(command.data.name, command);
          } else if (!command?.data){
            console.warn(`Command in module ${moduleName} is missing data`);
          } else if (!command.execute){
            console.warn(`Command in module ${moduleName} is missing execute function`);
          }
        }
      }
    }

    // Register commands with Discord
    const data = await rest.put(
      Routes.applicationGuildCommands(client.user.id, guildId),
      { body: commands }
    );

    console.log('Successfully reloaded application (/) commands.');
    console.log('Registration data:', data);
    return true;
  } catch (error) {
    console.error('Error registering commands:', error);
    if (error instanceof Error) {
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      if (error.message.includes('Missing Access')) {
          throw new Error('Bot lacks permissions to create commands. Ensure bot has "applications.commands" scope');
      } else if (error.message.includes('Unknown Guild')) {
          throw new Error(`Bot is not in the specified guild (ID: ${guildId})`);
      }
    }
    throw error;
  }
}