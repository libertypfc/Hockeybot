import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction, MessageReaction, User } from 'discord.js';
import { db } from '@db';
import { players, contracts, teams } from '@db/schema';
import { eq } from 'drizzle-orm';

export const ContractCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('offer')
      .setDescription('Offer a contract to a player')
      .addUserOption(option => 
        option.setName('player')
          .setDescription('The player to offer the contract to')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('team')
          .setDescription('The team offering the contract')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('salary')
          .setDescription('Annual salary in dollars')
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName('length')
          .setDescription('Contract length in days')
          .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
      const user = interaction.options.getUser('player', true);
      const teamName = interaction.options.getString('team', true);
      const salary = interaction.options.getInteger('salary', true);
      const length = interaction.options.getInteger('length', true);

      // Validate team exists and has cap space
      const team = await db.query.teams.findFirst({
        where: eq(teams.name, teamName),
      });

      if (!team) {
        return interaction.reply('Invalid team name');
      }

      const availableCap = team.availableCap ?? 0;
      if (availableCap < salary) {
        return interaction.reply('Team does not have enough cap space');
      }

      // Create or get player
      let player = await db.query.players.findFirst({
        where: eq(players.discordId, user.id),
      });

      if (!player) {
        const result = await db.insert(players).values({
          discordId: user.id,
          username: user.username,
        }).returning();
        player = result[0];
      }

      // Create contract
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + length);

      await db.insert(contracts).values({
        playerId: player.id,
        teamId: team.id,
        salary,
        lengthInDays: length,
        startDate,
        endDate,
      });

      // Create embed for contract offer
      const embed = new EmbedBuilder()
        .setTitle('Contract Offer')
        .setDescription(`${user} has been offered a contract by ${teamName}`)
        .addFields(
          { name: 'Salary', value: `$${salary.toLocaleString()}` },
          { name: 'Length', value: `${length} days` },
        );

      const message = await interaction.reply({ 
        embeds: [embed],
        fetchReply: true,
      });

      // Add reaction for acceptance
      await message.react('✅');
    },
  },
];