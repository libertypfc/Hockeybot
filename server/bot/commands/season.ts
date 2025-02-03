import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';
import { db } from '@db';
import { teams, seasons, gameSchedule } from '@db/schema';
import { eq } from 'drizzle-orm';

function generateSchedule(
  teams: { id: number; name: string }[],
  numberOfWeeks: number,
  startDate: Date
): { homeTeamId: number; awayTeamId: number; gameDate: Date; gameNumber: number }[] {
  const schedule: { homeTeamId: number; awayTeamId: number; gameDate: Date; gameNumber: number }[] = [];
  const numberOfTeams = teams.length;
  
  // If odd number of teams, add a "bye" team
  if (numberOfTeams % 2 !== 0) {
    teams.push({ id: -1, name: "BYE" });
  }

  // Generate all possible team pairings
  const teamPairings: { home: number; away: number }[] = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      if (teams[i].id !== -1 && teams[j].id !== -1) {
        teamPairings.push({ home: teams[i].id, away: teams[j].id });
      }
    }
  }

  // Shuffle team pairings
  for (let i = teamPairings.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [teamPairings[i], teamPairings[j]] = [teamPairings[j], teamPairings[i]];
  }

  // Generate schedule for the specified number of weeks
  let currentDate = new Date(startDate);
  let pairingIndex = 0;
  
  for (let week = 0; week < numberOfWeeks; week++) {
    // Wednesday games
    currentDate.setDate(currentDate.getDate() + (3 - currentDate.getDay() + 7) % 7);
    for (let gameSlot = 0; gameSlot < 2 && pairingIndex < teamPairings.length; gameSlot++) {
      const pairing = teamPairings[pairingIndex];
      // Add both home and away games for the pair
      schedule.push({
        homeTeamId: pairing.home,
        awayTeamId: pairing.away,
        gameDate: new Date(currentDate),
        gameNumber: 1
      });
      schedule.push({
        homeTeamId: pairing.away,
        awayTeamId: pairing.home,
        gameDate: new Date(currentDate),
        gameNumber: 2
      });
      pairingIndex++;
    }

    // Sunday games
    currentDate.setDate(currentDate.getDate() + (0 - currentDate.getDay() + 7) % 7);
    for (let gameSlot = 0; gameSlot < 2 && pairingIndex < teamPairings.length; gameSlot++) {
      const pairing = teamPairings[pairingIndex];
      schedule.push({
        homeTeamId: pairing.home,
        awayTeamId: pairing.away,
        gameDate: new Date(currentDate),
        gameNumber: 1
      });
      schedule.push({
        homeTeamId: pairing.away,
        awayTeamId: pairing.home,
        gameDate: new Date(currentDate),
        gameNumber: 2
      });
      pairingIndex++;
    }
  }

  return schedule;
}

export const SeasonCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('startseason')
      .setDescription('Start a new season')
      .addIntegerOption(option =>
        option.setName('weeks')
          .setDescription('Number of weeks in the season')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(52)),
    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const numberOfWeeks = interaction.options.getInteger('weeks', true);
        
        // Get all active teams
        const allTeams = await db.query.teams.findMany();
        
        if (allTeams.length < 2) {
          return interaction.editReply('Cannot start season: Need at least 2 teams');
        }

        const startDate = new Date();
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + (numberOfWeeks * 7));

        // Create new season
        const [season] = await db.insert(seasons)
          .values({
            startDate,
            endDate,
            numberOfWeeks,
            status: 'active',
          })
          .returning();

        // Generate schedule
        const schedule = generateSchedule(allTeams, numberOfWeeks, startDate);

        // Insert all games into database
        await db.insert(gameSchedule)
          .values(schedule.map(game => ({
            seasonId: season.id,
            ...game
          })));

        // Create schedule embed
        const scheduleEmbed = new EmbedBuilder()
          .setTitle('🏒 New Season Schedule')
          .setDescription(
            `Season started with ${allTeams.length} teams\n` +
            `Duration: ${numberOfWeeks} weeks\n` +
            `Start Date: ${startDate.toLocaleDateString()}\n` +
            `End Date: ${endDate.toLocaleDateString()}`
          )
          .addFields({ 
            name: 'Teams', 
            value: allTeams.map(team => `• ${team.name}`).join('\n')
          })
          .setColor('#4ade80')
          .setTimestamp();

        await interaction.editReply({ embeds: [scheduleEmbed] });

      } catch (error) {
        console.error('Error starting season:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to start season: ${errorMessage}`);
      }
    },
  },
];
