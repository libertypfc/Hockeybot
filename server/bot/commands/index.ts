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

  // Validate environment variables
  const token = process.env.DISCORD_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token) {
    console.error('Discord token not found');
    throw new Error('Discord token not found');
  }

  if (!guildId) {
    console.error('Discord guild ID not found');
    throw new Error('Discord guild ID not found');
  }

  console.log('Environment variables validated');
  console.log(`Bot application ID: ${client.user.id}`);
  console.log(`Target guild ID: ${guildId}`);

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log(`Started refreshing application (/) commands for ${client.user.tag}`);

    // Create a new Collection for commands
    client.commands = new Collection();

    // Collect valid commands
    const validCommands = new Map<string, {
      data: SlashCommandBuilder;
      execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
    }>();

    // Process each command module
    console.log('Processing command modules...');
    for (const [moduleName, moduleCommands] of Object.entries(CommandModules)) {
      console.log(`Processing module: ${moduleName}`);

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
        console.log(`Validating command: ${commandName} from ${moduleName}`);

        try {
          // Verify command data can be converted to JSON
          const commandJSON = command.data.toJSON();
          console.log(`Command ${commandName} data:`, JSON.stringify(commandJSON, null, 2));

          // Wrap the execute function to ensure it always returns Promise<void>
          const wrappedExecute = async (interaction: ChatInputCommandInteraction) => {
            try {
              await command.execute(interaction);
            } catch (error) {
              console.error(`Error executing command ${commandName}:`, error);
              throw error;
            }
          };

          validCommands.set(commandName, {
            data: command.data,
            execute: wrappedExecute
          });

          client.commands.set(commandName, {
            data: command.data,
            execute: wrappedExecute
          });

          console.log(`Command ${commandName} validated and registered successfully`);
        } catch (error) {
          console.error(`Failed to validate command ${commandName}:`, error);
          if (error instanceof Error) {
            console.error('Error details:', {
              name: error.name,
              message: error.message,
              stack: error.stack
            });
          }
          continue;
        }
      }
    }

    // Convert commands to JSON
    const commandData = Array.from(validCommands.values()).map(cmd => {
      const json = cmd.data.toJSON();
      console.log(`Prepared command for registration: ${json.name}`);
      return json;
    });

    console.log(`Prepared ${commandData.length} commands for registration`);

    try {
      // Delete all existing commands first
      console.log(`Deleting existing commands for application ${client.user.id} in guild ${guildId}`);
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, guildId),
        { body: [] }
      );

      // Wait for deletion to propagate
      console.log('Waiting for command deletion to propagate...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Register new commands
      console.log(`Registering ${commandData.length} commands for application ${client.user.id} in guild ${guildId}`);
      console.log('Command registration payload:', JSON.stringify(commandData, null, 2));

      const data = await rest.put(
        Routes.applicationGuildCommands(client.user.id, guildId),
        { body: commandData }
      );

      console.log('Successfully registered application (/) commands.');
      console.log('Registration response:', data);

      hasRegisteredGlobally = true;
      return true;

    } catch (error) {
      console.error('Error in command registration request:', error);
      if (error instanceof Error) {
        if (error.message.includes('Missing Access')) {
          throw new Error('Bot lacks permissions to create commands. Ensure bot has "applications.commands" scope');
        } else if (error.message.includes('Unknown Guild')) {
          throw new Error(`Bot is not in the specified guild (ID: ${guildId})`);
        }
      }
      throw error;
    }

  } catch (error) {
    console.error('Error in command registration:', error);
    if (error instanceof Error) {
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
    }
    hasRegisteredGlobally = false;
    throw error;
  }
}