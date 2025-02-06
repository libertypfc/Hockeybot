import { Client, GatewayIntentBits, Events, Collection, EmbedBuilder, TextChannel, DMChannel, ChannelType, SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { db } from '@db';
import { players, contracts, teams, guildSettings } from '@db/schema';
import { eq, and } from 'drizzle-orm';
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

export class DiscordBot extends Client {
  private isConnecting: boolean = false;
  private reconnectAttempt: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly CONNECT_TIMEOUT = 60000; // 60 seconds
  private readonly RECONNECT_DELAY = 5000;
  private heartbeatInterval?: NodeJS.Timeout;
  private connectionMonitor?: NodeJS.Timeout;

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
      presence: {
        status: 'online',
        activities: [{
          name: 'Hockey League',
          type: 0
        }]
      },
      failIfNotExists: false,
      rest: {
        retries: 5,
        timeout: 60000
      }
    });

    this.commands = new Collection();
    this.setupEventHandlers();
  }

  private log(message: string, level: 'info' | 'error' | 'warn' | 'debug' = 'info') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [BOT ${level.toUpperCase()}] ${message}`);
  }

  private setupEventHandlers() {
    // Connection state monitoring
    this.on(Events.Error, this.handleError.bind(this));
    this.on(Events.Debug, this.handleDebug.bind(this));
    this.on(Events.Warn, this.handleWarning.bind(this));
    this.once(Events.ClientReady, this.handleReady.bind(this));
    this.on(Events.Disconnect, this.handleDisconnect.bind(this));
    this.on(Events.Resume, this.handleResume.bind(this));

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
          // If the interaction was already replied to or expired
          console.error('Could not send error message to user');
        }
      }
    });
  }

  private startHeartbeat() {
    this.stopHeartbeat(); // Clear any existing interval
    this.heartbeatInterval = setInterval(() => {
      if (!this.isReady() || !this.ws) {
        this.log('Heartbeat failed - connection lost', 'error');
        this.handleDisconnect();
        return;
      }
      this.log('Heartbeat OK - connection stable', 'debug');
    }, 30000); // Check every 30 seconds
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  private startConnectionMonitor() {
    this.stopConnectionMonitor(); // Clear any existing monitor
    this.connectionMonitor = setInterval(() => {
      if (!this.isReady()) {
        this.log('Connection monitor detected disconnection', 'warn');
        this.handleDisconnect();
      }
    }, 60000); // Check every minute
  }

  private stopConnectionMonitor() {
    if (this.connectionMonitor) {
      clearInterval(this.connectionMonitor);
      this.connectionMonitor = undefined;
    }
  }

  private handleError(error: Error) {
    this.log(`Error encountered: ${error.message}`, 'error');
    console.error(error);

    if (!this.isConnecting) {
      this.reconnectAttempt = 0;
      this.start().catch(e => this.log(`Reconnection failed: ${e.message}`, 'error'));
    }
  }

  private handleDebug(message: string) {
    if (message.includes('Session Limit Information') || 
        message.includes('Gateway') || 
        message.includes('Heartbeat')) {
      this.log(message, 'debug');
    }
  }

  private handleWarning(message: string) {
    this.log(message, 'warn');
  }

  private async handleReady(client: Client) {
    this.log(`Logged in as ${client.user?.tag}`, 'info');
    this.reconnectAttempt = 0;

    this.startHeartbeat();
    this.startConnectionMonitor();

    try {
      await registerCommands(this);
      this.log('Commands registered successfully');

      // Start periodic tasks
      setInterval(() => checkExpiredContracts(), 5 * 60 * 1000);
      setInterval(() => checkCapCompliance(this), 15 * 60 * 1000);
    } catch (error) {
      this.log(`Failed to initialize: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }

  private handleDisconnect() {
    this.log('Disconnected from Discord', 'warn');
    this.stopHeartbeat();
    this.stopConnectionMonitor();

    if (!this.isConnecting) {
      this.reconnectAttempt = 0;
      setTimeout(() => {
        this.start().catch(error => {
          this.log(`Failed to reconnect: ${error.message}`, 'error');
        });
      }, this.RECONNECT_DELAY);
    }
  }

  private handleResume() {
    this.log('Connection resumed', 'info');
    this.startHeartbeat();
    this.startConnectionMonitor();
  }

  async start(): Promise<boolean> {
    if (this.isConnecting) {
      this.log('Already attempting to connect...', 'warn');
      return false;
    }

    this.isConnecting = true;

    try {
      if (!process.env.DISCORD_TOKEN) {
        throw new Error('DISCORD_TOKEN environment variable is not set');
      }

      this.log(`Connection attempt ${this.reconnectAttempt + 1}/${this.MAX_RECONNECT_ATTEMPTS}`);

      // Clear any existing intervals
      this.stopHeartbeat();
      this.stopConnectionMonitor();

      await this.login(process.env.DISCORD_TOKEN);

      // Wait for ready event
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timed out'));
        }, this.CONNECT_TIMEOUT);

        this.once(Events.ClientReady, () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.log('Connection established successfully');
      this.isConnecting = false;
      return true;

    } catch (error) {
      this.log(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');

      if (this.reconnectAttempt < this.MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempt++;
        this.isConnecting = false;
        await new Promise(resolve => setTimeout(resolve, this.RECONNECT_DELAY));
        return this.start();
      }

      this.isConnecting = false;
      throw new Error(`Failed to connect after ${this.MAX_RECONNECT_ATTEMPTS} attempts`);
    }
  }
}

export const client = new DiscordBot();

export async function startBot(): Promise<DiscordBot> {
  try {
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