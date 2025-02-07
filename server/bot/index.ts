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
  private readonly INITIAL_CONNECT_TIMEOUT = 60000;
  private readonly MAX_CONNECT_TIMEOUT = 300000;
  private readonly INITIAL_RECONNECT_DELAY = 5000;
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
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildModeration,
      ],
      presence: {
        status: 'online',
        activities: [{
          name: 'Hockey League',
          type: 0
        }]
      },
      allowedMentions: { parse: ['users', 'roles'] },
    });

    this.commands = new Collection();
    this.setupEventHandlers();
    DiscordBot.instance = this;
  }

  private cleanup(): void {
    try {
      this.removeAllListeners();
      if (this.ws) {
        this.ws.removeAllListeners();
      }
      this.guilds.cache.clear();
      this.channels.cache.clear();
      this.users.cache.clear();
      this.stopHeartbeat();
      this.stopConnectionMonitor();
    } catch (error) {
      this.log(`Error during cleanup: ${error}`, 'error');
    }
  }

  private log(message: string, level: 'info' | 'error' | 'warn' | 'debug' = 'info'): void {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [BOT ${level.toUpperCase()}] ${message}`);
  }

  private setupEventHandlers(): void {
    this.on(Events.Error, this.handleError.bind(this));
    this.on(Events.Debug, this.handleDebug.bind(this));
    this.on(Events.Warn, this.handleWarning.bind(this));
    this.once(Events.ClientReady, this.handleReady.bind(this));
    this.on(Events.Disconnect, this.handleDisconnect.bind(this));
    this.on(Events.Resume, this.handleResume.bind(this));
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

  private startHeartbeat(): void {
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
      }
    }, 20000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  private startConnectionMonitor(): void {
    this.stopConnectionMonitor();
    this.connectionMonitor = setInterval(() => {
      if (!this.isReady() || !this.ws?.ping) {
        this.log('Connection monitor detected potential disconnection', 'warn');
        this.handleDisconnect();
      }
    }, 60000);
  }

  private stopConnectionMonitor(): void {
    if (this.connectionMonitor) {
      clearInterval(this.connectionMonitor);
      this.connectionMonitor = undefined;
    }
  }

  async start(): Promise<boolean> {
    if (this.isConnecting) {
      this.log('Already attempting to connect...', 'warn');
      return false;
    }

    this.isConnecting = true;

    try {
      const token = process.env.DISCORD_TOKEN;
      if (!token) {
        throw new Error('DISCORD_TOKEN environment variable is not set');
      }

      // Validate token format
      if (!token.startsWith('MTA') && !token.startsWith('MTI') && !token.startsWith('MTM')) {
        throw new Error('Invalid Discord bot token format. Token should start with MTA, MTI, or MTM');
      }

      if (token.length < 50) {
        throw new Error('Invalid Discord bot token length. Token seems too short');
      }

      this.log(`Connection attempt ${this.reconnectAttempt + 1}/${this.MAX_RECONNECT_ATTEMPTS}`);
      this.log('Validating token format...', 'debug');
      this.log(`Token prefix: ${token.substring(0, 3)}`, 'debug');
      this.log(`Token length: ${token.length}`, 'debug');

      this.cleanup();
      this.commands = new Collection();
      this.setupEventHandlers();

      try {
        this.log('Attempting to login with token...', 'debug');
        await this.login(token);
        this.log('Login successful', 'info');
      } catch (loginError) {
        if (loginError instanceof Error) {
          this.log(`Login error details: ${loginError.message}`, 'error');

          // Provide more specific error messages based on the error
          if (loginError.message.includes('invalid token')) {
            throw new Error('Discord rejected the token. Please verify the token is correct and not expired. Error: ' + loginError.message);
          } else if (loginError.message.includes('disallowed intents')) {
            throw new Error('Bot token valid but missing required privileged intents. Enable them in Discord Developer Portal. Error: ' + loginError.message);
          } else if (loginError.message.includes('Unknown')) {
            throw new Error('Discord API could not recognize the token. Please ensure you\'re using the correct token from your application\'s Bot page. Error: ' + loginError.message);
          }
          throw loginError;
        }
        throw new Error('Unknown login error occurred');
      }

      this.log('Connection established successfully', 'info');
      this.isConnecting = false;
      this.reconnectAttempt = 0;
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log(`Connection failed: ${errorMessage}`, 'error');
      console.error('Full error details:', error);

      if (this.reconnectAttempt < this.MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempt++;
        this.isConnecting = false;
        const backoffTime = Math.min(5000 * Math.pow(2, this.reconnectAttempt), 30000);
        this.log(`Waiting ${backoffTime}ms before retry...`, 'info');
        await new Promise(resolve => setTimeout(resolve, backoffTime));
        return this.start();
      }

      this.isConnecting = false;
      throw new Error(`Failed to connect after ${this.MAX_RECONNECT_ATTEMPTS} attempts: ${errorMessage}`);
    }
  }

  private handleError(error: Error): void {
    this.log(`Error encountered: ${error.message}`, 'error');
    console.error(error);

    if (!this.isConnecting) {
      this.reconnectAttempt = 0;
      this.start().catch(e => this.log(`Reconnection failed: ${e.message}`, 'error'));
    }
  }

  private handleWarning(message: string): void {
    this.log(message, 'warn');
  }

  private handleDebug(message: string): void {
    if (message.includes('Session Limit Information') ||
        message.includes('Gateway') ||
        message.includes('Heartbeat') ||
        message.includes('WebSocket')) {
      this.log(message, 'debug');
    }
  }

  private handleDisconnect(): void {
    this.log('Disconnected from Discord', 'warn');
    this.cleanup();

    if (!this.isConnecting) {
      this.start().catch(error => {
        this.log(`Failed to reconnect: ${error.message}`, 'error');
      });
    }
  }

  private handleResume(): void {
    this.log('Connection resumed', 'info');
    this.startHeartbeat();
    this.startConnectionMonitor();
  }

  private async registerCommandsWithRetry(maxAttempts = 5): Promise<void> {
    let attempt = 0;

    while (attempt < maxAttempts) {
      try {
        this.log(`Attempting to register commands (attempt ${attempt + 1}/${maxAttempts})`, 'info');

        if (!this.isReady() || !this.user) {
          throw new Error('Client not ready for command registration');
        }

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

        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        this.log(`Waiting ${delay}ms before next attempt`, 'debug');
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  private startPeriodicChecks(): void {
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
  private async handleReady() {
    this.log('Bot is ready and connected to Discord', 'info');
    this.log(`Bot User Info: ${this.user?.tag} (ID: ${this.user?.id})`, 'debug');
    this.log(`Connected to ${this.guilds.cache.size} guilds`, 'debug');
    this.log(`Bot permissions: ${this.user?.flags?.toArray().join(', ') || 'None'}`, 'debug');

    // Reset reconnection counter on successful connection
    this.reconnectAttempt = 0;
    this.isConnecting = false;

    try {
      // Verify we have the required environment variables
      if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_GUILD_ID) {
        throw new Error('Missing required environment variables (DISCORD_TOKEN or DISCORD_GUILD_ID)');
      }

      // Log guild connection status
      const targetGuild = this.guilds.cache.get(process.env.DISCORD_GUILD_ID);
      if (!targetGuild) {
        throw new Error(`Bot is not connected to the target guild (ID: ${process.env.DISCORD_GUILD_ID})`);
      }
      this.log(`Successfully connected to target guild: ${targetGuild.name}`, 'info');

      // Initialize achievements first
      await initializeAchievements();
      this.log('Achievements initialized', 'info');

      // Register commands with retries
      if (!this.hasRegisteredCommands) {
        this.log('Starting command registration...', 'debug');
        try {
          await this.registerCommandsWithRetry();
          this.log('Command registration completed successfully', 'info');
        } catch (error) {
          this.log(`Command registration failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
          throw error;
        }
      }

      // Start monitoring systems
      this.startHeartbeat();
      this.startConnectionMonitor();
      this.startPeriodicChecks();

    } catch (error) {
      this.log(`Initialization error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      if (error instanceof Error) {
        this.log(`Error stack: ${error.stack}`, 'error');
      }
      await this.handleDisconnect();
    }
  }
}

export const client = new DiscordBot();

export async function startBot(): Promise<DiscordBot> {
  try {
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