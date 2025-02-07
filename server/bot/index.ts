import { Client, GatewayIntentBits, Events, Collection, EmbedBuilder, TextChannel, DMChannel, ChannelType, SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { db } from '@db';
import { players, contracts, teams, guildSettings } from '@db/schema';
import { eq, and } from 'drizzle-orm';
import { registerCommands } from './commands/index';
import { checkCapCompliance } from './commands/admin';
import { initializeAchievements, checkUptimeAchievements } from './achievements';

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, {
      data: SlashCommandBuilder,
      execute: (interaction: ChatInputCommandInteraction) => Promise<void>
    }>;
  }
}

export class DiscordBot extends Client {
  private static instance: DiscordBot | null = null;
  private isConnecting: boolean = false;
  private reconnectAttempt: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly INITIAL_CONNECT_TIMEOUT = 60000; // Increased to 60 seconds
  private readonly MAX_CONNECT_TIMEOUT = 300000;
  private readonly INITIAL_RECONNECT_DELAY = 5000; // Increased initial delay
  private readonly MAX_RECONNECT_DELAY = 60000;
  private heartbeatInterval?: NodeJS.Timeout;
  private connectionMonitor?: NodeJS.Timeout;
  private hasRegisteredCommands: boolean = false;

  constructor() {
    if (DiscordBot.instance) {
      return DiscordBot.instance;
    }

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
      presence: {
        status: 'online',
        activities: [{
          name: 'Hockey League',
          type: 0
        }]
      },
      waitGuildTimeout: 15000,
      rest: {
        timeout: 60000,
        retries: 5
      }
    });

    this.commands = new Collection();
    this.setupEventHandlers();
    DiscordBot.instance = this;
  }

  private log(message: string, level: 'info' | 'error' | 'warn' | 'debug' = 'info') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [BOT ${level.toUpperCase()}] ${message}`);
  }

  private calculateBackoff(): { delay: number; timeout: number } {
    const backoffFactor = Math.min(Math.pow(1.5, this.reconnectAttempt), 5);
    const jitter = Math.random() * 500;
    const delay = Math.min(
      this.INITIAL_RECONNECT_DELAY * backoffFactor + jitter,
      this.MAX_RECONNECT_DELAY
    );
    const timeout = Math.min(
      this.INITIAL_CONNECT_TIMEOUT * backoffFactor,
      this.MAX_CONNECT_TIMEOUT
    );
    return { delay, timeout };
  }

  private setupEventHandlers() {
    this.on(Events.Error, this.handleError.bind(this));
    this.on(Events.Debug, this.handleDebug.bind(this));
    this.on(Events.Warn, this.handleWarning.bind(this));
    this.once(Events.ClientReady, this.handleReady.bind(this));
    this.on('disconnect', this.handleDisconnect.bind(this));
    this.on('resume', this.handleResume.bind(this));
    this.ws?.on('close', this.handleWebSocketClose.bind(this));

    this.ws?.on('sessionStarted', (data: any) => {
      this.log(`Session established: ${data.session_id}`, 'debug');
    });

    this.on(Events.GuildMemberAdd, async (member) => {
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
    this.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;

      try {
        if (message.mentions.has(this.user!)) {
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
    this.on(Events.MessageReactionAdd, async (reaction, user) => {
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

    this.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const command = this.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`Error executing command ${interaction.commandName}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

        try {
          await interaction.reply({
            content: `Error executing command: ${errorMessage}`,
            ephemeral: true
          });
        } catch {
          console.error('Could not send error message to user');
        }
      }
    });
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (!this.ws?.ping) {
        this.log('WebSocket ping not available, connection may be dead', 'warn');
        this.handleDisconnect();
        return;
      }

      const ping = this.ws.ping;
      if (ping > 200) {
        this.log(`High latency detected: ${ping}ms`, 'warn');

        this.channels.cache.clear();
        this.users.cache.clear();
        this.guilds.cache.sweep(guild => !guild.available);

        if (ping > 500) {
          this.log('Latency exceeded threshold, initiating clean reconnection', 'warn');
          this.destroy();
          this.handleDisconnect();
          return;
        }
      }

      this.log(`Heartbeat OK - Latency: ${ping}ms`, 'debug');
    }, 20000);
  }

  private startConnectionMonitor() {
    this.stopConnectionMonitor();
    this.connectionMonitor = setInterval(() => {
      if (!this.isReady() || !this.ws?.ping) {
        this.log('Connection monitor detected potential disconnection', 'warn');
        this.handleDisconnect();
        return;
      }

      this.removeAllListeners('disconnect');
      this.removeAllListeners('resume');
      this.on('disconnect', this.handleDisconnect.bind(this));
      this.on('resume', this.handleResume.bind(this));

      if (global.gc) {
        try {
          global.gc();
        } catch (error) {
          this.log('Failed to run garbage collection', 'debug');
        }
      }

      const guilds = this.guilds.cache.size;
      if (guilds === 0 && !this.isConnecting) {
        this.log('No guilds available, possible connection issue', 'warn');
        this.handleDisconnect();
      }
    }, 60000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  private stopConnectionMonitor() {
    if (this.connectionMonitor) {
      clearInterval(this.connectionMonitor);
      this.connectionMonitor = undefined;
    }
  }

  private async handleWebSocketClose(code: number) {
    this.log(`WebSocket closed with code ${code}`, 'warn');

    const resumableCodes = [1000, 1001, 1006];
    if (resumableCodes.includes(code)) {
      this.log('WebSocket closure is resumable, attempting to reconnect', 'info');
      await this.attemptReconnect();
    } else {
      this.log('WebSocket closure requires fresh connection', 'warn');
      await this.attemptReconnect();
    }
  }

  private async attemptReconnect() {
    if (this.isConnecting) return;

    const { delay, timeout } = this.calculateBackoff();
    this.log(`Scheduling reconnection attempt in ${delay}ms with ${timeout}ms timeout`, 'info');

    await new Promise(resolve => setTimeout(resolve, delay));
    await this.start();
  }

  private handleError(error: Error) {
    this.log(`Error encountered: ${error.message}`, 'error');
    console.error(error);

    if (!this.isConnecting) {
      this.reconnectAttempt = 0;
      this.attemptReconnect().catch(e =>
        this.log(`Reconnection failed: ${e.message}`, 'error')
      );
    }
  }

  private handleWarning(message: string) {
    this.log(message, 'warn');
  }

  private handleDebug(message: string) {
    if (message.includes('Session Limit Information') ||
      message.includes('Gateway') ||
      message.includes('Heartbeat') ||
      message.includes('WebSocket')) {
      this.log(message, 'debug');
    }
  }

  private async handleReady(client: Client) {
    this.log('Bot is ready and connected to Discord', 'info');

    // Reset reconnection counter on successful connection
    this.reconnectAttempt = 0;
    this.isConnecting = false;

    try {
      // Initialize achievements first
      await initializeAchievements();
      this.log('Achievements initialized', 'info');

      // Register commands with retries
      if (!this.hasRegisteredCommands) {
        await this.registerCommandsWithRetry();
      }

      // Start monitoring systems
      this.startHeartbeat();
      this.startConnectionMonitor();
      this.startPeriodicChecks();

    } catch (error) {
      this.log(`Initialization error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      await this.handleDisconnect();
    }
  }

  private async registerCommandsWithRetry(maxAttempts = 5): Promise<void> {
    let attempt = 0;

    while (attempt < maxAttempts) {
      try {
        this.log(`Attempting to register commands (attempt ${attempt + 1}/${maxAttempts})`, 'info');

        await registerCommands(this);
        this.hasRegisteredCommands = true;
        this.log('Commands registered successfully', 'info');
        return;

      } catch (error) {
        attempt++;
        this.log(`Command registration attempt ${attempt} failed: ${error}`, 'error');

        if (attempt === maxAttempts) {
          throw new Error(`Failed to register commands after ${maxAttempts} attempts`);
        }

        // Exponential backoff with maximum delay
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async start(): Promise<boolean> {
    if (this.isConnecting) {
      this.log('Already attempting to connect...', 'warn');
      return false;
    }

    this.isConnecting = true;
    const { timeout } = this.calculateBackoff();

    try {
      if (!process.env.DISCORD_TOKEN) {
        throw new Error('DISCORD_TOKEN environment variable is not set');
      }

      this.log(`Connection attempt ${this.reconnectAttempt + 1}/${this.MAX_RECONNECT_ATTEMPTS}`);

      this.stopHeartbeat();
      this.stopConnectionMonitor();

      // Clear any existing state
      this.commands = new Collection();
      this.removeAllListeners();
      this.setupEventHandlers();

      // Increase timeout for initial connection
      const loginTimeout = Math.max(timeout, 60000); // At least 60 seconds for initial connection

      await Promise.race([
        this.login(process.env.DISCORD_TOKEN),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Login timed out')), loginTimeout)
        )
      ]);

      // Wait for ready event with increased timeout
      await new Promise<void>((resolve, reject) => {
        const readyTimeout = setTimeout(() => {
          reject(new Error('Ready event timed out'));
        }, loginTimeout);

        this.once(Events.ClientReady, () => {
          clearTimeout(readyTimeout);
          resolve();
        });
      });

      this.log('Connection established successfully', 'info');
      this.isConnecting = false;
      this.reconnectAttempt = 0;
      return true;

    } catch (error) {
      this.log(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');

      if (this.reconnectAttempt < this.MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempt++;
        this.isConnecting = false;
        await new Promise(resolve => setTimeout(resolve, 5000)); // Add delay between retries
        return this.start();
      }

      this.isConnecting = false;
      throw new Error(`Failed to connect after ${this.MAX_RECONNECT_ATTEMPTS} attempts`);
    }
  }

  private startPeriodicChecks() {
    setInterval(() => {
      checkExpiredContracts().catch(error =>
        this.log(`Error checking expired contracts: ${error}`, 'error')
      );
    }, 5 * 60 * 1000);

    setInterval(() => {
      checkCapCompliance(this).catch(error =>
        this.log(`Error checking cap compliance: ${error}`, 'error')
      );
    }, 15 * 60 * 1000);

    setInterval(() => {
      checkUptimeAchievements(this).catch(error =>
        this.log(`Error checking uptime achievements: ${error}`, 'error')
      );
    }, 60 * 60 * 1000);
  }

  private handleDisconnect() {
    this.log('Disconnected from Discord', 'warn');

    this.stopHeartbeat();
    this.stopConnectionMonitor();

    this.rest.clearTimeout();
    this.ws?.destroy();

    if (!this.isConnecting) {
      this.attemptReconnect().catch(error => {
        this.log(`Failed to reconnect: ${error.message}`, 'error');
      });
    }
  }

  private handleResume() {
    this.log('Connection resumed', 'info');
    this.startHeartbeat();
    this.startConnectionMonitor();
  }

  private async destroy() {
    try {
      this.removeAllListeners();

      if (this.ws) {
        this.ws.removeAllListeners();
        this.ws.destroy();
      }

      this.rest.clearTimeout();

      this.guilds.cache.clear();
      this.channels.cache.clear();
      this.users.cache.clear();

      this.stopHeartbeat();
      this.stopConnectionMonitor();

    } catch (error) {
      this.log(`Error during cleanup: ${error}`, 'error');
    }
  }
}

export const client = new DiscordBot();

export async function startBot(): Promise<DiscordBot> {
  try {
    // Verify token exists
    if (!process.env.DISCORD_TOKEN) {
      throw new Error('DISCORD_TOKEN is not set in environment variables');
    }

    const success = await client.start();
    if (!success) {
      throw new Error('Failed to start bot');
    }

    return client;
  } catch (error) {
    console.error('Bot startup failed:', error);
    throw error;
  }
}

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
      const metadata = JSON.parse(contract.metadata || '{}');
      if (!metadata.expiresAt) continue;

      const expirationDate = new Date(metadata.expiresAt);
      if (now > expirationDate) {
        await db.update(contracts)
          .set({ status: 'expired' })
          .where(eq(contracts.id, contract.id));

        if (metadata.offerMessageId) {
          try {
            const guild = client.guilds.cache.first();
            if (!guild) continue;

            const textChannels = guild.channels.cache
              .filter(channel => channel.type === ChannelType.GuildText);

            for (const channel of textChannels.values()) {
              try {
                const message = await (channel as TextChannel).messages.fetch(metadata.offerMessageId);
                if (message) {
                  const expiredEmbed = EmbedBuilder.from(message.embeds[0])
                    .setDescription('⏰ This contract offer has expired');
                  await message.edit({ embeds: [expiredEmbed] });
                  break;
                }
              } catch {
                continue;
              }
            }
          } catch (error) {
            console.error('Error updating expired contract message:', error);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error checking expired contracts:', error);
  }
}