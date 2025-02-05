import { Client, GatewayIntentBits, Events, Collection, ChatInputCommandInteraction } from 'discord.js';
import { log } from '../vite';
import { TeamCommands } from './commands/team';
import { ContractCommands } from './commands/contract';
import { TradeCommands } from './commands/trade';
import { WaiversCommands } from './commands/waivers';
import { handleTradeButtons } from './interactions/tradeButtons';

let client: Client | null = null;

export function getClient() {
  if (!client) {
    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
      failIfNotExists: false,
      rest: {
        timeout: 60000,
        retries: 5
      }
    });
  }
  return client;
}

// Store commands in a collection
const commands: Collection<string, any> = new Collection();

// Register all commands
[...TeamCommands, ...ContractCommands, ...TradeCommands, ...WaiversCommands].forEach(command => {
  if (command.data) {
    commands.set(command.data.name, command);
  }
});

export async function startBot() {
  try {
    const client = getClient();

    // Set up error handling
    client.on('error', error => {
      log(`Discord client error: ${error.message}`, 'discord');
      // Attempt to reconnect after error
      setTimeout(() => {
        log('Attempting to reconnect after error...', 'discord');
        startBot();
      }, 5000);
    });

    client.on('disconnect', () => {
      log('Bot disconnected, attempting to reconnect...', 'discord');
      setTimeout(() => {
        startBot();
      }, 5000);
    });

    // Set up event handlers
    client.once(Events.ClientReady, async c => {
      log(`Ready! Logged in as ${c.user.tag}`, 'discord');
      log(`Bot is in ${c.guilds.cache.size} guilds`, 'discord');

      // Register commands with Discord
      try {
        const commandsArray = Array.from(commands.values());
        const commandsData = commandsArray.map(cmd => cmd.data);
        await client.application?.commands.set(commandsData);
        log('Successfully registered application commands.', 'discord');
      } catch (error) {
        log('Error registering commands:', 'discord');
        console.error(error);
      }
    });

    // Handle interactions
    client.on(Events.InteractionCreate, async interaction => {
      try {
        if (interaction.isButton()) {
          if (interaction.customId.startsWith('accept_trade:') ||
              interaction.customId.startsWith('reject_trade:') ||
              interaction.customId.startsWith('approve_trade:') ||
              interaction.customId.startsWith('reject_trade_admin:')) {
            await handleTradeButtons(interaction);
          }
          return;
        }

        if (!interaction.isChatInputCommand()) return;

        const command = commands.get(interaction.commandName);
        if (!command) {
          log(`No command matching ${interaction.commandName} was found.`, 'discord');
          return;
        }

        if (typeof command.execute === 'function') {
          await command.execute(interaction);
        } else {
          log(`Command ${interaction.commandName} has no execute function`, 'discord');
        }
      } catch (error) {
        log(`Error handling interaction: ${error}`, 'discord');
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: 'There was an error executing this command.',
            ephemeral: true
          });
        }
      }
    });

    // Set up heartbeat check with reconnection logic
    setInterval(() => {
      if (!client.ws.ping) {
        log('No heartbeat detected, attempting to reconnect...', 'discord');
        startBot();
      } else {
        log(`Heartbeat ping: ${client.ws.ping}ms`, 'discord');
      }
    }, 30000);

    // Login with token
    if (!client.isReady()) {
      await client.login(process.env.DISCORD_TOKEN);
      log('Bot successfully started and connected!', 'discord');
    }

    return client;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to start Discord bot: ${errorMessage}`, 'discord');

    // Attempt to reconnect after failure
    setTimeout(() => {
      log('Attempting to reconnect after startup failure...', 'discord');
      startBot();
    }, 5000);

    return null;
  }
}

export default getClient();