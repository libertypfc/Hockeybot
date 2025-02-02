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

client.once(Events.ClientReady, () => {
  console.log('Discord bot is ready!');
  registerCommands(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    await interaction.reply({
      content: 'There was an error executing this command!',
      ephemeral: true,
    });
  }
});

export function startBot() {
  client.login(process.env.DISCORD_TOKEN);
}