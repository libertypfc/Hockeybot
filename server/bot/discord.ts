import { Client, GatewayIntentBits, Events, Collection } from 'discord.js';
import { log } from '../vite';
import { TeamCommands } from './commands/team';
import { ContractCommands } from './commands/contract';
import { TradeCommands } from './commands/trade';
import { WaiversCommands } from './commands/waivers';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Store commands in a collection
const commands = new Collection();

// Register all commands
[...TeamCommands, ...ContractCommands, ...TradeCommands, ...WaiversCommands].forEach(command => {
  commands.set(command.data.name, command);
});

export async function startBot() {
  try {
    // Set up event handlers
    client.once(Events.ClientReady, async c => {
      log(`Ready! Logged in as ${c.user.tag}`, 'discord');
      log(`Bot is in ${c.guilds.cache.size} guilds`, 'discord');

      // Register commands with Discord
      try {
        const commandsData = [...commands.values()].map(cmd => cmd.data);
        await client.application?.commands.set(commandsData);
        log('Successfully registered application commands.', 'discord');
      } catch (error) {
        log('Error registering commands:', error);
      }
    });

    // Handle interactions
    client.on(Events.InteractionCreate, async interaction => {
      if (!interaction.isChatInputCommand()) return;

      const command = commands.get(interaction.commandName);
      if (!command) {
        log(`No command matching ${interaction.commandName} was found.`, 'discord');
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        log(`Error executing ${interaction.commandName}`, error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';

        const replyContent = {
          content: `There was an error executing this command: ${errorMessage}`,
          ephemeral: true
        };

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(replyContent);
        } else {
          await interaction.reply(replyContent);
        }
      }
    });

    client.on(Events.Error, error => {
      log(`Discord client error: ${error.message}`, 'discord');
    });

    // Set up heartbeat check
    setInterval(() => {
      if (client.ws.ping > 0) {
        log(`Heartbeat ping: ${client.ws.ping}ms`, 'discord');
      }
    }, 30000);

    // Login with token
    await client.login(process.env.DISCORD_TOKEN);
    log('Bot successfully started and connected!', 'discord');

    return client;
  } catch (error) {
    log(`Failed to start Discord bot: ${error}`, 'discord');
    throw error;
  }
}

export default client;