import { Client, GatewayIntentBits, Events, Collection } from 'discord.js';
import { db } from '@db';
import { registerCommands } from './commands';

// Extend the Client type to include commands
declare module 'discord.js' {
  interface Client {
    commands: Collection<string, any>;
  }
}

if (!process.env.DISCORD_TOKEN) {
  throw new Error('DISCORD_TOKEN environment variable is required');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// Initialize the commands collection
client.commands = new Collection();

client.once(Events.ClientReady, async (c) => {
  console.log(`Discord bot is ready! Logged in as ${c.user.tag}`);

  // Wait a short time to ensure guilds are cached
  await new Promise(resolve => setTimeout(resolve, 1000));

  try {
    await registerCommands(client);
    console.log('All commands registered successfully!');
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.error(`Command not found: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing command ${interaction.commandName}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    await interaction.reply({
      content: `There was an error executing this command: ${errorMessage}`,
      ephemeral: true,
    });
  }
});

export function startBot() {
  client.login(process.env.DISCORD_TOKEN)
    .then(() => {
      console.log('Bot successfully logged in!');
    })
    .catch((error) => {
      console.error('Failed to start the bot:', error);
      throw error;
    });
}