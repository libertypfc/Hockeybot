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

class ReliableDiscordClient extends Client {
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 20;
  private baseDelay: number = 1000;
  private heartbeatInterval?: NodeJS.Timeout;
  private watchdogInterval?: NodeJS.Timeout;
  private connectionCheckInterval?: NodeJS.Timeout;
  private isShuttingDown: boolean = false;
  private lastHeartbeat: number = Date.now();
  private forcedReconnectTimeout?: NodeJS.Timeout;
  private isReconnecting: boolean = false;

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

    // Enhanced error logging and connection management
    this.on('error', this.handleError.bind(this));
    this.on('debug', (message) => console.log(`[Debug] ${message}`));
    this.on('warn', (message) => console.warn(`[Warning] ${message}`));
    this.on('disconnect', this.handleDisconnect.bind(this));
    this.on('reconnecting', () => console.log('[Status] Bot is reconnecting...'));
    this.on('ready', () => {
      console.log('[Status] Bot is ready and connected!');
      this.lastHeartbeat = Date.now();
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      this.startConnectionCheck();
    });

    // Handle process termination
    process.on('SIGINT', () => this.handleShutdown());
    process.on('SIGTERM', () => this.handleShutdown());
    process.on('uncaughtException', this.handleUncaughtError.bind(this));
    process.on('unhandledRejection', this.handleUncaughtError.bind(this));
  }

  private startConnectionCheck() {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
    }

    // Check connection status every 10 seconds
    this.connectionCheckInterval = setInterval(() => {
      if (!this.isReady() && !this.isReconnecting) {
        console.log('[Connection] Bot is not ready, initiating reconnection...');
        this.attemptReconnect(true);
      }
    }, 10000);
  }

  private handleUncaughtError(error: Error) {
    console.error('[Critical Error] Uncaught error:', error);
    if (!this.isShuttingDown && !this.isReconnecting) {
      this.attemptReconnect(true);
    }
  }

  private async handleError(error: Error) {
    console.error('[Error] Bot encountered an error:', error);
    if (!this.isShuttingDown && !this.isReconnecting) {
      await this.attemptReconnect(true);
    }
  }

  private async handleDisconnect() {
    console.log('[Status] Bot disconnected from Discord');
    if (!this.isShuttingDown && !this.isReconnecting) {
      await this.attemptReconnect(true);
    }
  }

  private async attemptReconnect(force: boolean = false) {
    if (this.isShuttingDown || this.isReconnecting) return;

    this.isReconnecting = true;
    console.log('[Recovery] Starting reconnection process...');

    if (force) {
      console.log('[Recovery] Forcing immediate reconnection attempt...');
      this.reconnectAttempts = 0;
    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Recovery] Maximum reconnection attempts reached. Resetting client...');
      try {
        await this.destroy();
        await this.login(process.env.DISCORD_TOKEN);
        this.startHeartbeat();
        this.startConnectionCheck();
        this.isReconnecting = false;
        return;
      } catch (error) {
        console.error('[Recovery] Failed to reset client:', error);
        process.exit(1); // Force process restart on complete failure
      }
    }

    const delay = force ? 0 : this.baseDelay * Math.pow(1.5, this.reconnectAttempts);
    console.log(`[Recovery] Attempting to reconnect in ${delay}ms (Attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      if (this.isReady()) {
        await this.destroy();
      }

      await this.login(process.env.DISCORD_TOKEN);
      this.lastHeartbeat = Date.now();
      if (!force) {
        this.reconnectAttempts = 0;
      }
      console.log('[Recovery] Successfully reconnected to Discord!');

      // Schedule a forced reconnect after 4 hours to prevent stale connections
      if (this.forcedReconnectTimeout) {
        clearTimeout(this.forcedReconnectTimeout);
      }
      this.forcedReconnectTimeout = setTimeout(() => {
        console.log('[Maintenance] Performing scheduled connection refresh...');
        this.attemptReconnect(true);
      }, 4 * 60 * 60 * 1000);

      this.isReconnecting = false;
    } catch (error) {
      console.error('[Recovery] Reconnection attempt failed:', error);
      this.reconnectAttempts++;
      this.isReconnecting = false;
      await this.attemptReconnect();
    }
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);

    // Send heartbeat every 15 seconds
    this.heartbeatInterval = setInterval(() => {
      if (this.isReady()) {
        this.lastHeartbeat = Date.now();
        console.log('[Heartbeat] Connection alive');
      } else {
        console.log('[Heartbeat] Check failed, connection may be dead');
        if (!this.isReconnecting) {
          this.attemptReconnect(true);
        }
      }
    }, 15000);

    // Watchdog checks every 10 seconds
    this.watchdogInterval = setInterval(() => {
      const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;
      if (timeSinceLastHeartbeat > 30000 && !this.isReconnecting) { // No heartbeat for 30 seconds
        console.log('[Watchdog] Detected stale connection, forcing reconnect...');
        this.attemptReconnect(true);
      }
    }, 10000);
  }

  async start() {
    try {
      await this.login(process.env.DISCORD_TOKEN);
      this.startHeartbeat();
      this.startConnectionCheck();
      console.log('[Startup] Bot successfully started and connected!');

      this.forcedReconnectTimeout = setTimeout(() => {
        this.attemptReconnect(true);
      }, 4 * 60 * 60 * 1000);

    } catch (error) {
      console.error('[Startup] Failed to start the bot:', error);
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
              // Try to find the message in all available channels
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
      // Try to send DM first
      await member.user.send({ embeds: [welcomeEmbed] });
    } catch (error) {
      console.warn(`[Warning] Could not send welcome DM to ${member.user.tag}`, error);

      // Get configured welcome channel
      const settings = await db.query.guildSettings.findFirst({
        where: eq(guildSettings.guildId, member.guild.id),
      });

      let welcomeChannel;
      if (settings?.welcomeChannelId) {
        welcomeChannel = await member.guild.channels.fetch(settings.welcomeChannelId);
      }

      // Fallback to finding a general channel if no channel is configured
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

    // Set up periodic checks
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

export function startBot() {
  client.start()
    .catch((error) => {
      console.error('Critical error starting bot:', error);
      throw error;
    });
}