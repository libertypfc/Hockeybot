import { Client, GatewayIntentBits, Events, Collection, ChatInputCommandInteraction } from 'discord.js';
import { log } from '../vite';
import { TeamCommands } from './commands/team';
import { ContractCommands } from './commands/contract';
import { TradeCommands } from './commands/trade';
import { WaiversCommands } from './commands/waivers';
import { handleTradeButtons } from './interactions/tradeButtons';

let client: Client | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectAttempts = 0;
let lastReconnectTime = 0;
const RECONNECT_COOLDOWN = 60000; // 1 minute cooldown between reconnection cycles

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
        retries: 3
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

async function attemptReconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Check cooldown
  const now = Date.now();
  if (now - lastReconnectTime < RECONNECT_COOLDOWN) {
    log('Reconnection attempted too soon, waiting for cooldown...', 'discord');
    return;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    log('Maximum reconnection attempts reached. Please check bot token and restart manually.', 'discord');
    cleanup();
    return;
  }

  reconnectAttempts++;
  lastReconnectTime = now;

  // Exponential backoff
  const backoffTime = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
  log(`Attempting to reconnect in ${backoffTime}ms (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`, 'discord');

  reconnectTimeout = setTimeout(async () => {
    try {
      if (client) {
        client.destroy();
        client = null;
      }

      const newClient = getClient();
      await newClient.login(process.env.DISCORD_TOKEN);
      reconnectAttempts = 0; // Reset on successful connection
      log('Reconnection successful', 'discord');
    } catch (error) {
      log(`Reconnection failed: ${error}`, 'discord');
      attemptReconnect();
    }
  }, backoffTime);
}

function cleanup() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (client) {
    client.destroy();
    client = null;
  }
}

export async function startBot() {
  cleanup(); // Clear any existing timers and connections

  try {
    const client = getClient();

    client.on('error', error => {
      log(`Discord client error: ${error.message}`, 'discord');
      if (!reconnectTimeout) {
        attemptReconnect();
      }
    });

    client.on('disconnect', () => {
      log('Bot disconnected', 'discord');
      if (!reconnectTimeout) {
        attemptReconnect();
      }
    });

    // Set up event handlers
    client.once(Events.ClientReady, async c => {
      log(`Ready! Logged in as ${c.user.tag}`, 'discord');
      log(`Bot is in ${c.guilds.cache.size} guilds`, 'discord');
      reconnectAttempts = 0; // Reset counter on successful connection

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

    // Set up heartbeat check with longer interval and less aggressive reconnection
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }

    heartbeatInterval = setInterval(() => {
      if (client.isReady()) {
        log(`Heartbeat ping: ${client.ws.ping}ms`, 'discord');
      }
    }, 300000); // Check every 5 minutes instead of 30 seconds

    // Login with token
    if (!client.isReady()) {
      await client.login(process.env.DISCORD_TOKEN);
      log('Bot successfully started and connected!', 'discord');
    }

    return client;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to start Discord bot: ${errorMessage}`, 'discord');

    if (!reconnectTimeout) {
      attemptReconnect();
    }

    return null;
  }
}

// Cleanup on process termination
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

export default getClient();