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

  // Get the first guild the bot is in
  const guilds = await client.guilds.fetch();
  if (guilds.size === 0) {
    throw new Error('Bot is not in any guilds');
  }

  // Use the first guild's ID
  const firstGuild = guilds.first();
  if (!firstGuild) {
    throw new Error('Failed to get first guild');
  }

  const guildId = firstGuild.id;
  console.log(`Using guild ID: ${guildId}`);

  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error('Discord token not found');
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('Started refreshing application (/) commands.');

    // Create a new Collection for commands
    client.commands = new Collection();

    // Track command names to prevent duplicates
    const usedCommandNames = new Set<string>();
    const commands = [];

    // Collect all commands from modules and check for duplicates
    for (const [moduleName, moduleCommands] of Object.entries(CommandModules)) {
      if (Array.isArray(moduleCommands)) {
        for (const command of moduleCommands) {
          if (command?.data && command.execute) {
            const commandName = command.data.name;

            // Check for duplicate command names
            if (usedCommandNames.has(commandName)) {
              console.warn(`Duplicate command name '${commandName}' found in ${moduleName}. Skipping.`);
              continue;
            }

            usedCommandNames.add(commandName);
            commands.push(command.data.toJSON());
            client.commands.set(commandName, command);
          } else {
            console.warn(`Invalid command in module ${moduleName}`);
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
    console.log(`Registered ${commands.length} commands in guild ${guildId}`);
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