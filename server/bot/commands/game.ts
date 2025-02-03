import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { db } from '@db';
import { teams, players, playerStats, goalieStats } from '@db/schema';
import { eq, and, sql } from 'drizzle-orm';

export const GameCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('recordgame')
      .setDescription('Record a game result between two teams')
      .addRoleOption(option =>
        option.setName('hometeam')
          .setDescription('Home team')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('homescore')
          .setDescription('Home team score')
          .setRequired(true))
      .addRoleOption(option =>
        option.setName('awayteam')
          .setDescription('Away team')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('awayscore')
          .setDescription('Away team score')
          .setRequired(true))
      .addBooleanOption(option =>
        option.setName('overtime')
          .setDescription('Was the game decided in overtime?')
          .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const homeTeamRole = interaction.options.getRole('hometeam', true);
        const awayTeamRole = interaction.options.getRole('awayteam', true);
        const homeScore = interaction.options.getInteger('homescore', true);
        const awayScore = interaction.options.getInteger('awayscore', true);
        const isOvertime = interaction.options.getBoolean('overtime', true);

        // Get teams from database
        const homeTeam = await db.query.teams.findFirst({
          where: eq(teams.name, homeTeamRole.name),
        });

        const awayTeam = await db.query.teams.findFirst({
          where: eq(teams.name, awayTeamRole.name),
        });

        if (!homeTeam || !awayTeam) {
          return interaction.editReply('One or both teams not found in database');
        }

        // Update home team stats
        await db.update(teams)
          .set({
            goalsFor: sql`${teams.goalsFor} + ${homeScore}`,
            goalsAgainst: sql`${teams.goalsAgainst} + ${awayScore}`,
            wins: homeScore > awayScore ? sql`${teams.wins} + 1` : teams.wins,
            losses: homeScore < awayScore ? sql`${teams.losses} + 1` : teams.losses,
            overtimeLosses: homeScore < awayScore && isOvertime ? sql`${teams.overtimeLosses} + 1` : teams.overtimeLosses,
          })
          .where(eq(teams.id, homeTeam.id));

        // Update away team stats
        await db.update(teams)
          .set({
            goalsFor: sql`${teams.goalsFor} + ${awayScore}`,
            goalsAgainst: sql`${teams.goalsAgainst} + ${homeScore}`,
            wins: awayScore > homeScore ? sql`${teams.wins} + 1` : teams.wins,
            losses: awayScore < homeScore ? sql`${teams.losses} + 1` : teams.losses,
            overtimeLosses: awayScore < homeScore && isOvertime ? sql`${teams.overtimeLosses} + 1` : teams.overtimeLosses,
          })
          .where(eq(teams.id, awayTeam.id));

        const embed = new EmbedBuilder()
          .setTitle('Game Result Recorded')
          .setDescription(`${homeTeamRole} ${homeScore} - ${awayScore} ${awayTeamRole}${isOvertime ? ' (OT)' : ''}`)
          .setColor('#00FF00')
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Error recording game result:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to record game result: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('teamstats')
      .setDescription('View team statistics')
      .addRoleOption(option =>
        option.setName('team')
          .setDescription('The team to view stats for')
          .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const teamRole = interaction.options.getRole('team', true);

        const team = await db.query.teams.findFirst({
          where: eq(teams.name, teamRole.name),
        });

        if (!team) {
          return interaction.editReply('Team not found in database');
        }

        const embed = new EmbedBuilder()
          .setTitle(`${team.name} Statistics`)
          .addFields(
            { name: 'Record', value: `${team.wins || 0}-${team.losses || 0}-${team.overtimeLosses || 0}`, inline: true },
            { name: 'Goals For', value: (team.goalsFor || 0).toString(), inline: true },
            { name: 'Goals Against', value: (team.goalsAgainst || 0).toString(), inline: true },
            { 
              name: 'Points', 
              value: ((team.wins || 0) * 2 + (team.overtimeLosses || 0)).toString(),
              inline: true 
            }
          )
          .setColor('#0099ff')
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Error displaying team stats:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to display team stats: ${errorMessage}`);
      }
    },
  },
];