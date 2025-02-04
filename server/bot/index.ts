import { Client, GatewayIntentBits, Events, Collection, EmbedBuilder, TextChannel, DMChannel, ChannelType, SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { db } from '@db';
import { players, contracts, teams, guildSettings } from '@db/schema';
import { eq, and, lt } from 'drizzle-orm';
import { registerCommands } from './commands';
import { checkCapCompliance } from './commands/admin';

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, {
      data: SlashCommandBuilder,
      execute: (interaction: ChatInputCommandInteraction) => Promise<void>
    }>;
  }
}

enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  ERROR = 'ERROR'
}

class ReliableDiscordClient extends Client {
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 20;
  private baseDelay: number = 1000;
  private heartbeatInterval?: NodeJS.Timeout;
  private watchdogInterval?: NodeJS.Timeout;
  private connectionCheckInterval?: NodeJS.Timeout;
  private stateCheckInterval?: NodeJS.Timeout;
  private isShuttingDown: boolean = false;
  private lastHeartbeat: number = Date.now();
  private forcedReconnectTimeout?: NodeJS.Timeout;
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private lastError?: Error;
  private processStartTime: number = Date.now();
  private wsCloseTimeout?: NodeJS.Timeout;

  constructor() {
    super({
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
      failIfNotExists: false,
      rest: {
        retries: 5,
        timeout: 15000,
      },
    });

    this.commands = new Collection();
    this.setupEventHandlers();
    this.setupProcessHandlers();
  }

  private setupEventHandlers() {
    this.on('error', this.handleError.bind(this));
    this.on('debug', (message) => this.log('Debug', message));
    this.on('warn', (message) => this.log('Warning', message));
    this.on('disconnect', this.handleDisconnect.bind(this));
    this.on('reconnecting', () => this.setConnectionState(ConnectionState.RECONNECTING));
    this.on('ready', () => {
      this.setConnectionState(ConnectionState.CONNECTED);
      this.lastHeartbeat = Date.now();
      this.reconnectAttempts = 0;
      this.startAllMonitors();
    });

    // Handle WebSocket events directly
    this.ws?.on('close', (code: number) => {
      console.log(`[WebSocket] Gateway connection closed with code ${code}`);

      // Handle specific close codes
      switch (code) {
        case 1000: // Normal closure
          console.log('[WebSocket] Normal closure, attempting reconnect');
          break;
        case 1001: // Going away
          console.log('[WebSocket] Gateway server going away, will attempt reconnect');
          break;
        case 1006: // Abnormal closure
          console.error('[WebSocket] Abnormal closure detected');
          break;
        default:
          console.log(`[WebSocket] Unexpected close code: ${code}`);
      }

      // Let the client's built-in reconnection handle it
      if (code !== 1000) {
        client.destroy().then(() => {
          console.log('[WebSocket] Client destroyed, preparing reconnect');
          client.login(process.env.DISCORD_TOKEN);
        }).catch(err => {
          console.error('[WebSocket] Error during client cleanup:', err);
        });
      }
    });
  }

  private setupProcessHandlers() {
    process.on('SIGINT', () => this.handleShutdown('SIGINT'));
    process.on('SIGTERM', () => this.handleShutdown('SIGTERM'));
    process.on('uncaughtException', (error) => this.handleUncaughtError(error));
    process.on('unhandledRejection', (error) => this.handleUncaughtError(error as Error));
  }

  private log(level: string, message: string, error?: Error) {
    const timestamp = new Date().toISOString();
    const errorStack = error ? `\n${error.stack}` : '';
    console.log(`[${timestamp}] [${level}] ${message}${errorStack}`);
  }

  private setConnectionState(state: ConnectionState) {
    this.connectionState = state;
    this.log('State', `Connection state changed to ${state}`);
  }

  private startAllMonitors() {
    this.startHeartbeat();
    this.startConnectionCheck();
    this.startStateCheck();
  }

  private clearAllIntervals() {
    [
      this.heartbeatInterval,
      this.watchdogInterval,
      this.connectionCheckInterval,
      this.stateCheckInterval,
      this.forcedReconnectTimeout,
      this.wsCloseTimeout
    ].forEach(interval => {
      if (interval) clearInterval(interval);
    });
  }

  private startStateCheck() {
    if (this.stateCheckInterval) clearInterval(this.stateCheckInterval);

    this.stateCheckInterval = setInterval(() => {
      const uptime = Math.floor((Date.now() - this.processStartTime) / 1000);
      this.log('Status', `Bot Status Report:
        State: ${this.connectionState}
        Uptime: ${uptime}s
        Last Heartbeat: ${Date.now() - this.lastHeartbeat}ms ago
        Reconnect Attempts: ${this.reconnectAttempts}
        Last Error: ${this.lastError?.message || 'None'}`);
    }, 30000);
  }

  private startConnectionCheck() {
    if (this.connectionCheckInterval) clearInterval(this.connectionCheckInterval);

    this.connectionCheckInterval = setInterval(() => {
      if (!this.isReady() && this.connectionState !== ConnectionState.RECONNECTING) {
        this.log('Connection', 'Bot is not ready, initiating reconnection...');
        this.attemptReconnect(true);
      }
    }, 3000); // Check every 3 seconds
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);

    this.heartbeatInterval = setInterval(() => {
      if (this.isReady()) {
        this.lastHeartbeat = Date.now();
        this.log('Heartbeat', 'Connection alive');
      } else {
        this.log('Heartbeat', 'Check failed, connection may be dead');
        if (this.connectionState !== ConnectionState.RECONNECTING) {
          this.attemptReconnect(true);
        }
      }
    }, 3000); // Heartbeat every 3 seconds

    this.watchdogInterval = setInterval(() => {
      const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;
      if (timeSinceLastHeartbeat > 7000 &&
        this.connectionState !== ConnectionState.RECONNECTING) {
        this.log('Watchdog', 'Detected stale connection, forcing reconnect...');
        this.attemptReconnect(true);
      }
    }, 3000); // Check every 3 seconds
  }

  private async handleUncaughtError(error: Error) {
    this.lastError = error;
    this.log('Critical', 'Uncaught error', error);
    this.setConnectionState(ConnectionState.ERROR);

    if (!this.isShuttingDown && this.connectionState !== ConnectionState.RECONNECTING) {
      await this.attemptReconnect(true);
    }
  }

  private async handleError(error: Error) {
    this.lastError = error;
    this.log('Error', 'Bot encountered an error', error);
    this.setConnectionState(ConnectionState.ERROR);

    if (!this.isShuttingDown && this.connectionState !== ConnectionState.RECONNECTING) {
      await this.attemptReconnect(true);
    }
  }

  private async handleDisconnect() {
    this.log('Status', 'Bot disconnected from Discord');
    this.setConnectionState(ConnectionState.DISCONNECTED);

    if (!this.isShuttingDown && this.connectionState !== ConnectionState.RECONNECTING) {
      await this.attemptReconnect(true);
    }
  }

  private async attemptReconnect(force: boolean = false) {
    if (this.isShuttingDown || this.connectionState === ConnectionState.RECONNECTING) return;

    this.setConnectionState(ConnectionState.RECONNECTING);
    this.log('Recovery', 'Starting reconnection process...');

    if (force) {
      this.log('Recovery', 'Forcing immediate reconnection attempt...');
      this.reconnectAttempts = 0;
    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log('Recovery', 'Maximum reconnection attempts reached. Resetting process...');
      process.exit(1); // Force process restart through Replit
    }

    const delay = force ? 0 : this.baseDelay * Math.pow(1.5, this.reconnectAttempts);
    this.log('Recovery', `Attempting to reconnect in ${delay}ms (Attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      if (this.isReady()) {
        await this.destroy();
      }

      await this.login(process.env.DISCORD_TOKEN);
      this.lastHeartbeat = Date.now();
      this.setConnectionState(ConnectionState.CONNECTED);

      if (!force) {
        this.reconnectAttempts = 0;
      }

      // Schedule a forced reconnect after 2 hours
      if (this.forcedReconnectTimeout) {
        clearTimeout(this.forcedReconnectTimeout);
      }
      this.forcedReconnectTimeout = setTimeout(() => {
        this.log('Maintenance', 'Performing scheduled connection refresh...');
        this.attemptReconnect(true);
      }, 2 * 60 * 60 * 1000);

    } catch (error) {
      this.lastError = error as Error;
      this.log('Recovery', 'Reconnection attempt failed', error as Error);
      this.reconnectAttempts++;
      this.setConnectionState(ConnectionState.ERROR);
      await this.attemptReconnect();
    }
  }

  private async handleShutdown(signal: string) {
    this.log('Shutdown', `Shutting down bot gracefully... (${signal})`);
    this.isShuttingDown = true;
    this.setConnectionState(ConnectionState.DISCONNECTED);

    this.clearAllIntervals();

    try {
      await this.destroy();
      this.log('Shutdown', 'Bot shutdown complete');
      process.exit(0);
    } catch (error) {
      this.log('Shutdown', 'Error during shutdown', error as Error);
      process.exit(1);
    }
  }

  async start() {
    try {
      await this.login(process.env.DISCORD_TOKEN);
      this.startAllMonitors();
      this.log('Startup', 'Bot successfully started and connected!');

      // Schedule first forced reconnect after 2 hours
      this.forcedReconnectTimeout = setTimeout(() => {
        this.attemptReconnect(true);
      }, 2 * 60 * 60 * 1000);

    } catch (error) {
      this.log('Startup', 'Failed to start the bot', error as Error);
      await this.attemptReconnect(true);
    }
  }
}

const client = new ReliableDiscordClient();

async function checkExpiredContracts() {
  try {
    const now = new Date();

    const pendingContracts = await db.query.contracts.findMany({
      where: eq(contracts.status, 'pending'),
      with: {
        player: true,
        team: true,
      },
    });

    for (const contract of pendingContracts) {
      try {
        const metadata = JSON.parse(contract.metadata || '{}');
        if (!metadata.expiresAt) continue;

        const expirationDate = new Date(metadata.expiresAt);
        if (now > expirationDate) {
          await db.update(contracts)
            .set({ status: 'expired' })
            .where(eq(contracts.id, contract.id));

          if (metadata.offerMessageId) {
            try {
              const channels = await client.guilds.cache.first()?.channels.fetch();
              if (channels) {
                for (const [, channel] of channels) {
                  if (channel?.type === ChannelType.GuildText) {
                    try {
                      const message = await channel.messages.fetch(metadata.offerMessageId);
                      if (message) {
                        const expiredEmbed = EmbedBuilder.from(message.embeds[0])
                          .setDescription(`⏰ This contract offer has expired`);
                        await message.edit({ embeds: [expiredEmbed] });
                        break;
                      }
                    } catch (e) {
                      console.error(`[Error] Failed to fetch or edit message in channel ${channel.id}:`, e);
                      continue;
                    }
                  }
                }
              }
            } catch (error) {
              console.error('[Error] Error updating expired contract message:', error);
            }
          }
        }
      } catch (error) {
        console.error('[Error] Error processing contract:', error);
        continue;
      }
    }
  } catch (error) {
    console.error('[Error] Error checking expired contracts:', error);
  }
}

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const welcomeEmbed = new EmbedBuilder()
      .setTitle('🏒 Welcome to the Hockey League!')
      .setDescription(
        `Welcome ${member.user}, to our hockey league!\n\n` +
        `Here's what you need to know:\n` +
        `• Use our bot commands to manage your player career\n` +
        `• View your stats and performance on our web dashboard\n` +
        `• Teams can offer you contracts which you'll receive via DM\n` +
        `• Track your progress and milestones through our system\n\n` +
        `To get started:\n` +
        `1. Wait for a team to offer you a contract\n` +
        `2. Accept the contract by reacting with ✅\n` +
        `3. Start playing and tracking your stats!\n\n` +
        `Good luck and have fun! 🎮`
      )
      .setColor('#4ade80')
      .setTimestamp();

    try {
      await member.user.send({ embeds: [welcomeEmbed] });
    } catch (error) {
      console.warn(`[Warning] Could not send welcome DM to ${member.user.tag}`, error);

      const settings = await db.query.guildSettings.findFirst({
        where: eq(guildSettings.guildId, member.guild.id),
      });

      let welcomeChannel;
      if (settings?.welcomeChannelId) {
        welcomeChannel = await member.guild.channels.fetch(settings.welcomeChannelId);
      }

      if (!welcomeChannel || welcomeChannel?.type !== ChannelType.GuildText) {
        const channels = await member.guild.channels.fetch();
        welcomeChannel = channels.find(channel =>
          channel.type === ChannelType.GuildText &&
          channel.name.toLowerCase().includes('general')
        );
      }

      if (welcomeChannel && welcomeChannel.type === ChannelType.GuildText) {
        await welcomeChannel.send({
          content: `${member.user}`,
          embeds: [welcomeEmbed]
        });
      }
    }
  } catch (error) {
    console.error('[Error] Error sending welcome message:', error);
  }
});

client.once(Events.ClientReady, async (c) => {
  console.log(`[Status] Discord bot is ready! Logged in as ${c.user.tag}`);

  await new Promise(resolve => setTimeout(resolve, 1000));

  try {
    await registerCommands(client);
    console.log('[Status] All commands registered successfully!');

    setInterval(checkExpiredContracts, 5 * 60 * 1000); // Every 5 minutes
    setInterval(() => checkCapCompliance(client), 15 * 60 * 1000); // Every 15 minutes
  } catch (error) {
    console.error('[Error] Failed to register commands:', error);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  try {
    if (message.mentions.has(client.user!)) {
      const embed = new EmbedBuilder()
        .setTitle('👋 Hello!')
        .setDescription('I\'m your Hockey League Management Bot! Here are some things I can help you with:')
        .addFields(
          { name: 'Team Management', value: '/createteam, /teaminfo, /removeplayer' },
          { name: 'Player Management', value: '/trade, /release, /exemptplayer' },
          { name: 'Contracts', value: '/offer elc, /offer custom' }
        )
        .setFooter({ text: 'Use / to see all available commands' })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    }
  } catch (error) {
    console.error('[Error] Error handling message:', error);
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;

  try {
    if (reaction.emoji.name !== '✅' && reaction.emoji.name !== '❌') return;

    const message = reaction.message;

    if (!message.embeds[0]?.title?.includes('Contract Offer')) return;

    const player = await db.query.players.findFirst({
      where: eq(players.discordId, user.id),
      with: {
        currentTeam: true,
      },
    });

    if (!player) {
      console.error('[Error] Player not found in database');
      return;
    }

    const pendingContract = await db.query.contracts.findFirst({
      where: and(
        eq(contracts.playerId, player.id),
        eq(contracts.status, 'pending')
      ),
      with: {
        team: true,
      },
    });

    if (!pendingContract || !pendingContract.team) {
      console.error('[Error] No pending contract found');
      return;
    }

    if (reaction.emoji.name === '✅') {
      await db.update(contracts)
        .set({ status: 'active' })
        .where(eq(contracts.id, pendingContract.id));

      await db.update(teams)
        .set({
          availableCap: pendingContract.team.availableCap! - pendingContract.salary
        })
        .where(eq(teams.id, pendingContract.team.id));

      await db.update(players)
        .set({
          currentTeamId: pendingContract.team.id,
          status: 'signed'
        })
        .where(eq(players.id, player.id));

      const guild = message.guild;
      if (guild) {
        const member = await guild.members.fetch(user.id);
        const teamRole = guild.roles.cache.find(
          role => role.name === pendingContract.team.name
        );

        if (teamRole && member) {
          await member.roles.add(teamRole);
        }
      }

      const updatedEmbed = EmbedBuilder.from(message.embeds[0])
        .setDescription(`✅ Contract accepted by ${user}`);
      await message.edit({ embeds: [updatedEmbed] });

      const announcementEmbed = new EmbedBuilder()
        .setTitle('🎉 Contract Signing Announcement')
        .setDescription(`**${user}** has signed with **${pendingContract.team.name}**!`)
        .addFields(
          { name: 'Contract Details', value:
            `• Salary: $${pendingContract.salary.toLocaleString()}\n` +
            `• Length: ${pendingContract.lengthInDays} days\n` +
            `• Status: Active`
          },
          { name: 'Team Cap Space', value:
            `$${(pendingContract.team.availableCap! - pendingContract.salary).toLocaleString()} remaining`
          }
        )
        .setTimestamp();

      await message.channel.send({ embeds: [announcementEmbed] });

    } else if (reaction.emoji.name === '❌') {
      await db.update(contracts)
        .set({ status: 'declined' })
        .where(eq(contracts.id, pendingContract.id));

      const updatedEmbed = EmbedBuilder.from(message.embeds[0])
        .setDescription(`❌ Contract declined by ${user}`);
      await message.edit({ embeds: [updatedEmbed] });
    }

  } catch (error) {
    console.error('[Error] Error processing contract reaction:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.error(`[Error] Command not found: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`[Error] Error executing command ${interaction.commandName}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    await interaction.reply({
      content: `There was an error executing this command: ${errorMessage}`,
      ephemeral: true,
    });
  }
});

export function startBot(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Add delay before starting to ensure server is ready
    setTimeout(() => {
      client.start()
        .then(() => {
          console.log('[Status] Bot started successfully');
          resolve();
        })
        .catch((error) => {
          console.error('[Error] Critical error starting bot:', error);
          reject(error);
        });
    }, 2000); // 2 second delay
  });
}