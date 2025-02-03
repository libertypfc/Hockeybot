import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { db } from '@db';
import { players, playerStats, goalieStats, games, teams } from '@db/schema';
import { eq, and, sql } from 'drizzle-orm';

export const StatsCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('recordstats')
      .setDescription('Record stats for a player in a game')
      .addUserOption(option => 
        option.setName('player')
          .setDescription('The player to record stats for')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('goals')
          .setDescription('Number of goals scored'))
      .addIntegerOption(option =>
        option.setName('assists')
          .setDescription('Number of assists'))
      .addIntegerOption(option =>
        option.setName('shots')
          .setDescription('Number of shots'))
      .addIntegerOption(option =>
        option.setName('hits')
          .setDescription('Number of hits'))
      .addIntegerOption(option =>
        option.setName('fow')
          .setDescription('Face-offs won'))
      .addIntegerOption(option =>
        option.setName('fototal')
          .setDescription('Total face-offs taken'))
      .addIntegerOption(option =>
        option.setName('takeaways')
          .setDescription('Number of takeaways'))
      .addIntegerOption(option =>
        option.setName('interceptions')
          .setDescription('Number of interceptions'))
      .addIntegerOption(option =>
        option.setName('giveaways')
          .setDescription('Number of giveaways'))
      .addIntegerOption(option =>
        option.setName('blockedshots')
          .setDescription('Number of blocked shots'))
      .addIntegerOption(option =>
        option.setName('passescompleted')
          .setDescription('Number of completed passes'))
      .addIntegerOption(option =>
        option.setName('passesattempted')
          .setDescription('Number of attempted passes'))
      .addIntegerOption(option =>
        option.setName('plusminus')
          .setDescription('Plus/minus rating')),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const user = interaction.options.getUser('player', true);

        // Get player from database
        const player = await db.query.players.findFirst({
          where: eq(players.discordId, user.id),
        });

        if (!player) {
          return interaction.editReply('Player not found in database');
        }

        // Get or create game record
        let game = await db.query.games.findFirst({
          where: and(
            eq(games.status, 'active'),
            sql`DATE(date) = CURRENT_DATE`
          ),
        });

        if (!game) {
          // Create a new game record for today
          const result = await db.insert(games).values({
            homeTeamId: player.currentTeamId!,
            awayTeamId: 0, // placeholder for now
            date: new Date(),
            status: 'active',
          }).returning();
          game = result[0];
        }

        // Record stats
        await db.insert(playerStats).values({
          playerId: player.id,
          gameId: game.id,
          goals: interaction.options.getInteger('goals') ?? 0,
          assists: interaction.options.getInteger('assists') ?? 0,
          shots: interaction.options.getInteger('shots') ?? 0,
          hits: interaction.options.getInteger('hits') ?? 0,
          faceoffsWon: interaction.options.getInteger('fow') ?? 0,
          faceoffsTotal: interaction.options.getInteger('fototal') ?? 0,
          takeaways: interaction.options.getInteger('takeaways') ?? 0,
          interceptions: interaction.options.getInteger('interceptions') ?? 0,
          giveaways: interaction.options.getInteger('giveaways') ?? 0,
          blockedShots: interaction.options.getInteger('blockedshots') ?? 0,
          passesCompleted: interaction.options.getInteger('passescompleted') ?? 0,
          passesAttempted: interaction.options.getInteger('passesattempted') ?? 0,
          plusMinus: interaction.options.getInteger('plusminus') ?? 0,
        });

        await interaction.editReply(`Stats recorded for ${user.username}`);

      } catch (error) {
        console.error('Error recording stats:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to record stats: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('recordgoalie')
      .setDescription('Record stats for a goalie in a game')
      .addUserOption(option => 
        option.setName('player')
          .setDescription('The goalie to record stats for')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('saves')
          .setDescription('Number of saves')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('goalsagainst')
          .setDescription('Goals against')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('breakaways')
          .setDescription('Number of breakaways faced'))
      .addIntegerOption(option =>
        option.setName('breakawaysaves')
          .setDescription('Number of breakaway saves'))
      .addIntegerOption(option =>
        option.setName('desperationsaves')
          .setDescription('Number of desperation saves')),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const user = interaction.options.getUser('player', true);

        // Get player from database
        const player = await db.query.players.findFirst({
          where: eq(players.discordId, user.id),
        });

        if (!player) {
          return interaction.editReply('Goalie not found in database');
        }

        // Get or create game record
        let game = await db.query.games.findFirst({
          where: and(
            eq(games.status, 'active'),
            sql`DATE(date) = CURRENT_DATE`
          ),
        });

        if (!game) {
          // Create a new game record for today
          const result = await db.insert(games).values({
            homeTeamId: player.currentTeamId!,
            awayTeamId: 0, // placeholder for now
            date: new Date(),
            status: 'active',
          }).returning();
          game = result[0];
        }

        // Record goalie stats
        await db.insert(goalieStats).values({
          playerId: player.id,
          gameId: game.id,
          saves: interaction.options.getInteger('saves', true),
          goalsAgainst: interaction.options.getInteger('goalsagainst', true),
          breakaways: interaction.options.getInteger('breakaways') ?? 0,
          breakawaySaves: interaction.options.getInteger('breakawaysaves') ?? 0,
          desperationSaves: interaction.options.getInteger('desperationsaves') ?? 0,
        });

        await interaction.editReply(`Goalie stats recorded for ${user.username}`);

      } catch (error) {
        console.error('Error recording goalie stats:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to record goalie stats: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('viewstats')
      .setDescription('View stats for a player')
      .addUserOption(option => 
        option.setName('player')
          .setDescription('The player to view stats for')
          .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const user = interaction.options.getUser('player', true);

        // Get player from database
        const player = await db.query.players.findFirst({
          where: eq(players.discordId, user.id),
        });

        if (!player) {
          return interaction.editReply('Player not found in database');
        }

        // Get aggregate stats for the player
        const stats = await db.query.playerStats.findMany({
          where: eq(playerStats.playerId, player.id),
        });

        if (stats.length === 0) {
          return interaction.editReply('No stats found for this player');
        }

        // Calculate totals and averages
        const totals = stats.reduce((acc, stat) => ({
          games: acc.games + 1,
          goals: acc.goals + stat.goals,
          assists: acc.assists + stat.assists,
          points: acc.points + stat.goals + stat.assists,
          plusMinus: acc.plusMinus + stat.plusMinus,
          shots: acc.shots + stat.shots,
          hits: acc.hits + stat.hits,
          faceoffsWon: acc.faceoffsWon + stat.faceoffsWon,
          faceoffsTotal: acc.faceoffsTotal + stat.faceoffsTotal,
          takeaways: acc.takeaways + stat.takeaways,
          giveaways: acc.giveaways + stat.giveaways,
          blockedShots: acc.blockedShots + stat.blockedShots,
          passesCompleted: acc.passesCompleted + stat.passesCompleted,
          passesAttempted: acc.passesAttempted + stat.passesAttempted,
        }), {
          games: 0,
          goals: 0,
          assists: 0,
          points: 0,
          plusMinus: 0,
          shots: 0,
          hits: 0,
          faceoffsWon: 0,
          faceoffsTotal: 0,
          takeaways: 0,
          giveaways: 0,
          blockedShots: 0,
          passesCompleted: 0,
          passesAttempted: 0,
        });

        // Create stats embed
        const embed = new EmbedBuilder()
          .setTitle(`${user.username}'s Stats`)
          .addFields(
            { name: 'Games Played', value: totals.games.toString(), inline: true },
            { name: 'Goals', value: totals.goals.toString(), inline: true },
            { name: 'Assists', value: totals.assists.toString(), inline: true },
            { name: 'Points', value: totals.points.toString(), inline: true },
            { name: 'Plus/Minus', value: totals.plusMinus.toString(), inline: true },
            { name: 'Shots', value: totals.shots.toString(), inline: true },
            { name: 'Hits', value: totals.hits.toString(), inline: true },
            { name: 'Face-off %', value: totals.faceoffsTotal > 0 
              ? `${((totals.faceoffsWon / totals.faceoffsTotal) * 100).toFixed(1)}%`
              : 'N/A', 
              inline: true 
            },
            { name: 'Takeaways', value: totals.takeaways.toString(), inline: true },
            { name: 'Giveaways', value: totals.giveaways.toString(), inline: true },
            { name: 'Blocked Shots', value: totals.blockedShots.toString(), inline: true },
            { name: 'Pass %', value: totals.passesAttempted > 0
              ? `${((totals.passesCompleted / totals.passesAttempted) * 100).toFixed(1)}%`
              : 'N/A',
              inline: true
            }
          );

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Error viewing stats:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to view stats: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('viewgoalie')
      .setDescription('View stats for a goalie')
      .addUserOption(option => 
        option.setName('player')
          .setDescription('The goalie to view stats for')
          .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const user = interaction.options.getUser('player', true);

        // Get player from database
        const player = await db.query.players.findFirst({
          where: eq(players.discordId, user.id),
        });

        if (!player) {
          return interaction.editReply('Goalie not found in database');
        }

        // Get aggregate stats for the goalie
        const stats = await db.query.goalieStats.findMany({
          where: eq(goalieStats.playerId, player.id),
        });

        if (stats.length === 0) {
          return interaction.editReply('No goalie stats found for this player');
        }

        // Calculate totals and averages
        const totals = stats.reduce((acc, stat) => ({
          games: acc.games + 1,
          saves: acc.saves + stat.saves,
          goalsAgainst: acc.goalsAgainst + stat.goalsAgainst,
          breakaways: acc.breakaways + stat.breakaways,
          breakawaySaves: acc.breakawaySaves + stat.breakawaySaves,
          desperationSaves: acc.desperationSaves + stat.desperationSaves,
        }), {
          games: 0,
          saves: 0,
          goalsAgainst: 0,
          breakaways: 0,
          breakawaySaves: 0,
          desperationSaves: 0,
        });

        // Calculate advanced stats
        const savePercentage = ((totals.saves / (totals.saves + totals.goalsAgainst)) * 100).toFixed(1);
        const gaa = ((totals.goalsAgainst / totals.games)).toFixed(2);
        const breakawaySavePercentage = totals.breakaways > 0
          ? ((totals.breakawaySaves / totals.breakaways) * 100).toFixed(1)
          : 'N/A';

        // Create stats embed
        const embed = new EmbedBuilder()
          .setTitle(`${user.username}'s Goalie Stats`)
          .addFields(
            { name: 'Games Played', value: totals.games.toString(), inline: true },
            { name: 'Saves', value: totals.saves.toString(), inline: true },
            { name: 'Goals Against', value: totals.goalsAgainst.toString(), inline: true },
            { name: 'Save %', value: `${savePercentage}%`, inline: true },
            { name: 'GAA', value: gaa, inline: true },
            { name: 'Breakaways Faced', value: totals.breakaways.toString(), inline: true },
            { name: 'Breakaway Save %', value: breakawaySavePercentage.toString(), inline: true },
            { name: 'Desperation Saves', value: totals.desperationSaves.toString(), inline: true }
          );

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Error viewing goalie stats:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to view goalie stats: ${errorMessage}`);
      }
    },
  },
];
