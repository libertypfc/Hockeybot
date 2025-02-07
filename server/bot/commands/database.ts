import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder, ChannelType } from 'discord.js';
import { db } from '@db';
import { teams, players, contracts, waivers } from '@db/schema';
import { eq } from 'drizzle-orm';

const REQUIRED_ROLE_NAME = "Database Manager";

export const DatabaseCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('database')
      .setDescription('Database management commands')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand(subcommand =>
        subcommand
          .setName('purgeall')
          .setDescription('WARNING: Removes all data from the database')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('purgeplayers')
          .setDescription('WARNING: Removes all players from the database')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('purgecontracts')
          .setDescription('WARNING: Removes all contracts from the database')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('purgewaivers')
          .setDescription('WARNING: Removes all waivers from the database')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('addteam')
          .setDescription('Add a team directly to database')
          .addStringOption(option =>
            option.setName('name')
              .setDescription('Team name')
              .setRequired(true))
          .addStringOption(option =>
            option.setName('categoryid')
              .setDescription('Discord category ID')
              .setRequired(true))
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('addplayer')
          .setDescription('Add a player with custom contract to team')
          .addUserOption(option =>
            option.setName('player')
              .setDescription('The player to add')
              .setRequired(true))
          .addRoleOption(option =>
            option.setName('team')
              .setDescription('The team to add player to')
              .setRequired(true))
          .addIntegerOption(option =>
            option.setName('salary')
              .setDescription('Player salary')
              .setRequired(true))
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('addelc')
          .setDescription('Add a player with Entry Level Contract to team')
          .addUserOption(option =>
            option.setName('player')
              .setDescription('The player to add')
              .setRequired(true))
          .addRoleOption(option =>
            option.setName('team')
              .setDescription('The team to add player to')
              .setRequired(true))
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('listcategories')
          .setDescription('List all category IDs in the server')),

    async execute(interaction: ChatInputCommandInteraction) {
      try {
        await interaction.deferReply({ ephemeral: true });
        console.log('Database command initiated by:', interaction.user.tag);

        // Check if command is used in a guild
        if (!interaction.guild || !interaction.member) {
          console.log('Command used outside of guild context');
          return await interaction.editReply('This command can only be used in a server.');
        }

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const hasRequiredRole = member.roles.cache.some(role => role.name === REQUIRED_ROLE_NAME);

        if (!hasRequiredRole) {
          const errorMessage = `You need the "${REQUIRED_ROLE_NAME}" role to use database management commands.`;
          return await interaction.editReply(errorMessage);
        }

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
          case 'listcategories': {
            const categories = interaction.guild.channels.cache
              .filter(channel => channel.type === ChannelType.GuildCategory)
              .map(category => ({
                name: category.name,
                id: category.id
              }));

            if (categories.length === 0) {
              return interaction.editReply('No categories found in this server.');
            }

            const embed = new EmbedBuilder()
              .setTitle('Category IDs')
              .setDescription('Here are all category IDs in this server:')
              .addFields(
                categories.map(cat => ({
                  name: cat.name,
                  value: `\`${cat.id}\``,
                  inline: true
                }))
              )
              .setColor('#0099ff')
              .setFooter({ text: 'Use these IDs with the /database addteam command' });

            await interaction.editReply({ embeds: [embed] });
            break;
          }

          case 'addteam': {
            const name = interaction.options.getString('name', true);
            const categoryId = interaction.options.getString('categoryid', true);
            const guildId = interaction.guildId!;

            const [team] = await db.insert(teams)
              .values({
                name,
                guild_id: guildId,
                discord_category_id: categoryId,
                salary_cap: 82500000,
                available_cap: 82500000,
                cap_floor: 60375000,
                metadata: JSON.stringify({})
              })
              .returning();

            await interaction.editReply(`Team "${name}" added to database with ID ${team.id}`);
            break;
          }

          case 'addplayer': {
            const user = interaction.options.getUser('player', true);
            const teamRole = interaction.options.getRole('team', true);
            const salary = interaction.options.getInteger('salary', true);

            // Get team
            const team = await db.query.teams.findFirst({
              where: eq(teams.name, teamRole.name),
            });

            if (!team) {
              return interaction.editReply('Team not found in database');
            }

            // Create or get player
            let player = await db.query.players.findFirst({
              where: eq(players.discordId, user.id),
            });

            if (!player) {
              const [newPlayer] = await db.insert(players)
                .values({
                  discordId: user.id,
                  username: user.username,
                  currentTeamId: team.id,
                  status: 'signed',
                  salaryExempt: false,
                  welcomeMessageSent: true,
                })
                .returning();
              player = newPlayer;
            } else {
              await db.update(players)
                .set({
                  currentTeamId: team.id,
                  status: 'signed'
                })
                .where(eq(players.id, player.id));
            }

            // Create contract
            const startDate = new Date();
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 210); // 30 weeks

            await db.insert(contracts)
              .values({
                playerId: player.id,
                teamId: team.id,
                salary: salary * 1000000, // Convert to actual dollars
                lengthInDays: 210,
                startDate,
                endDate,
                status: 'active',
                metadata: JSON.stringify({}),
              });

            await interaction.editReply(
              `Added ${user.username} to ${team.name} with $${salary}M salary`
            );
            break;
          }

          case 'addelc': {
            const user = interaction.options.getUser('player', true);
            const teamRole = interaction.options.getRole('team', true);
            const salary = 925000; // Fixed ELC salary
            const lengthInDays = 210; // 30 weeks

            // Get team
            const team = await db.query.teams.findFirst({
              where: eq(teams.name, teamRole.name),
            });

            if (!team) {
              return interaction.editReply('Team not found in database');
            }

            // Create or get player
            let player = await db.query.players.findFirst({
              where: eq(players.discordId, user.id),
            });

            if (!player) {
              const [newPlayer] = await db.insert(players)
                .values({
                  discordId: user.id,
                  username: user.username,
                  currentTeamId: team.id,
                  status: 'signed',
                  salaryExempt: false,
                  welcomeMessageSent: true,
                })
                .returning();
              player = newPlayer;
            } else {
              await db.update(players)
                .set({
                  currentTeamId: team.id,
                  status: 'signed'
                })
                .where(eq(players.id, player.id));
            }

            // Create ELC contract
            const startDate = new Date();
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + lengthInDays);

            await db.insert(contracts)
              .values({
                playerId: player.id,
                teamId: team.id,
                salary,
                lengthInDays,
                startDate,
                endDate,
                status: 'active',
                metadata: JSON.stringify({
                  type: 'ELC'
                }),
              });

            await interaction.editReply(
              `Added ${user.username} to ${team.name} with Entry Level Contract ($925,000)`
            );
            break;
          }

          case 'purgeall':
            await db.delete(contracts);
            await db.delete(waivers);
            await db.delete(players);
            await db.delete(teams);
            await interaction.editReply('All data has been purged from the database.');
            break;

          case 'purgeplayers':
            await db.delete(players);
            await interaction.editReply('All players have been removed from the database.');
            break;

          case 'purgecontracts':
            await db.delete(contracts);
            await interaction.editReply('All contracts have been removed from the database.');
            break;

          case 'purgewaivers':
            await db.delete(waivers);
            await interaction.editReply('All waivers have been removed from the database.');
            break;

          default:
            await interaction.editReply('Invalid subcommand.');
        }
      } catch (error) {
        console.error('Error in database command:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';

        if (interaction.deferred) {
          await interaction.editReply(`Failed to execute command: ${errorMessage}`);
        } else {
          try {
            await interaction.reply({ content: `Failed to execute command: ${errorMessage}`, ephemeral: true });
          } catch (replyError) {
            console.error('Failed to send error message:', replyError);
          }
        }
      }
    },
  },
];