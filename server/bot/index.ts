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
  private readonly MAX_RECONNECT_ATTEMPTS = 10; // Increased for more attempts
  private readonly CONNECT_TIMEOUT = 60000; // Increased to 60 seconds
  private readonly RECONNECT_DELAY = 5000; // 5 seconds between attempts
  private connectionState: string = 'disconnected';

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
        timeout: 60000
      }
    });

    this.commands = new Collection();
    this.setupEventHandlers();
  }

  private log(level: string, message: string) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
  }

  private setupEventHandlers() {
    this.on(Events.Error, (error) => {
      this.connectionState = 'error';
      this.log('ERROR', `Discord client error: ${error.message}`);
      this.log('ERROR', error.stack || 'No stack trace available');

      // Attempt to reconnect on error
      if (!this.isConnecting) {
        this.reconnectAttempt = 0;
        this.start().catch(e => this.log('ERROR', `Reconnection failed: ${e}`));
      }
    });

    this.on(Events.Debug, (message) => {
      this.log('DEBUG', message);
    });

    this.on(Events.Warn, (message) => {
      this.connectionState = 'warning';
      this.log('WARN', message);
    });

    this.once(Events.ClientReady, async (client) => {
      this.connectionState = 'ready';
      this.reconnectAttempt = 0;
      this.log('INFO', `Logged in successfully as ${client.user.tag}`);

      try {
        await registerCommands(this);
        this.log('INFO', 'Successfully registered all commands');
      } catch (error) {
        this.log('ERROR', `Failed to register commands: ${error}`);
      }
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
          // If the interaction was already replied to or expired
          console.error('Could not send error message to user');
        }
      }
    });
  }

  async start(): Promise<boolean> {
    if (this.isConnecting) {
      this.log('WARN', 'Already attempting to connect...');
      return false;
    }

    this.isConnecting = true;
    this.connectionState = 'connecting';
    this.log('INFO', 'Starting Discord bot...');

    try {
      if (!process.env.DISCORD_TOKEN) {
        throw new Error('DISCORD_TOKEN environment variable is not set');
      }

      // Modified token validation to be less restrictive
      const token = process.env.DISCORD_TOKEN.trim();
      this.log('DEBUG', `Provided token: ${token.slice(0, 32)}.${'*'.repeat(27)}`);
      if (!token || token.length < 50) {  // Basic length check instead of strict regex
        throw new Error('Discord token appears to be invalid (too short)');
      }

      this.log('DEBUG', 'Preparing to connect to the gateway...');
      this.log('INFO', 'Attempting to connect to Discord...');
      this.log('DEBUG', `Connection attempt ${this.reconnectAttempt + 1}/${this.MAX_RECONNECT_ATTEMPTS}`);

      try {
        const loginPromise = this.login(token);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Login timed out')), this.CONNECT_TIMEOUT);
        });

        this.log('DEBUG', 'Attempting login...');
        await Promise.race([loginPromise, timeoutPromise]);
        this.log('INFO', 'Login successful, waiting for ready event...');

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            this.connectionState = 'timeout';
            this.log('ERROR', 'Timed out waiting for ready event');
            reject(new Error('Timed out waiting for ready event'));
          }, this.CONNECT_TIMEOUT);

          this.once(Events.ClientReady, () => {
            this.log('DEBUG', 'Received ready event');
            clearTimeout(timeout);
            this.log('INFO', 'Ready event received');
            resolve();
          });
        });

        this.log('INFO', 'Bot is fully ready and operational');
        this.isConnecting = false;
        return true;

      } catch (error) {
        this.connectionState = 'failed';
        this.log('ERROR', `Connection attempt failed: ${error}`);
        this.log('ERROR', error instanceof Error ? error.stack : 'No stack trace available');

        if (this.reconnectAttempt < this.MAX_RECONNECT_ATTEMPTS) {
          this.reconnectAttempt++;
          this.log('INFO', `Attempting to reconnect (${this.reconnectAttempt}/${this.MAX_RECONNECT_ATTEMPTS})...`);
          this.isConnecting = false;
          await new Promise(resolve => setTimeout(resolve, this.RECONNECT_DELAY));
          return await this.start();
        } else {
          throw new Error(`Failed to connect after ${this.MAX_RECONNECT_ATTEMPTS} attempts`);
        }
      }

    } catch (error) {
      this.connectionState = 'error';
      this.log('ERROR', `Failed to start bot: ${error}`);
      this.log('ERROR', error instanceof Error ? error.stack : 'No stack trace available');
      this.isConnecting = false;
      throw error;
    }
  }
}

export const client = new DiscordBot();

export async function startBot(): Promise<DiscordBot> {
  return new Promise((resolve, reject) => {
    console.log('[Status] Starting Discord bot...');

    const timeout = setTimeout(() => {
      reject(new Error('Bot startup timed out after 60 seconds'));
    }, 60000); // Increased timeout to 60 seconds

    client.start()
      .then(() => {
        clearTimeout(timeout);
        if (client.isReady()) {
          console.log('[Status] Bot is ready and connected!');
          resolve(client);
        } else {
          reject(new Error('Bot failed to become ready after login'));
        }
      })
      .catch((error) => {
        clearTimeout(timeout);
        console.error('[Error] Failed to start bot:', error);
        reject(error);
      });
  });
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
              const channels = Array.from(client.guilds.cache.first()?.channels.cache.values() ?? []);
              for (const channel of channels) {
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