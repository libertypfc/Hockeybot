import { Client, GatewayIntentBits, Events, Collection, EmbedBuilder } from 'discord.js';
import { db } from '@db';
import { players, contracts, teams } from '@db/schema';
import { eq, and, lt } from 'drizzle-orm';
import { registerCommands } from './commands';

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

client.commands = new Collection();

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
              const channels = await client.channels.fetch();
              for (const [, channel] of channels) {
                if (channel?.isTextBased()) {
                  try {
                    const message = await channel.messages.fetch(metadata.offerMessageId);
                    if (message) {
                      const expiredEmbed = EmbedBuilder.from(message.embeds[0])
                        .setDescription(`⏰ This contract offer has expired`);
                      await message.edit({ embeds: [expiredEmbed] });
                      break;
                    }
                  } catch (e) {
                    continue;
                  }
                }
              }
            } catch (error) {
              console.error('Error updating expired contract message:', error);
            }
          }
        }
      } catch (error) {
        console.error('Error processing contract:', error);
        continue;
      }
    }
  } catch (error) {
    console.error('Error checking expired contracts:', error);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Discord bot is ready! Logged in as ${c.user.tag}`);

  await new Promise(resolve => setTimeout(resolve, 1000));

  try {
    await registerCommands(client);
    console.log('All commands registered successfully!');

    setInterval(checkExpiredContracts, 5 * 60 * 1000);
  } catch (error) {
    console.error('Failed to register commands:', error);
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
    console.error('Error handling message:', error);
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
      console.error('Player not found in database');
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
      console.error('No pending contract found');
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
    console.error('Error processing contract reaction:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.error(`Command not found: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing command ${interaction.commandName}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    await interaction.reply({
      content: `There was an error executing this command: ${errorMessage}`,
      ephemeral: true,
    });
  }
});

export function startBot() {
  client.login(process.env.DISCORD_TOKEN)
    .then(() => {
      console.log('Bot successfully logged in!');
    })
    .catch((error) => {
      console.error('Failed to start the bot:', error);
      throw error;
    });
}