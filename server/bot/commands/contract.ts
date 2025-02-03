import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction, MessageReaction, User, Role } from 'discord.js';
import { db } from '@db';
import { players, contracts, teams } from '@db/schema';
import { eq } from 'drizzle-orm';

export const ContractCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('elc')
      .setDescription('Offer an Entry Level Contract to a player')
      .addUserOption(option => 
        option.setName('player')
          .setDescription('The player to offer the ELC to')
          .setRequired(true))
      .addRoleOption(option =>
        option.setName('team')
          .setDescription('The team offering the contract (use @team)')
          .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
      const user = interaction.options.getUser('player', true);
      const teamRole = interaction.options.getRole('team', true);

      // Validate team exists and has cap space
      const team = await db.query.teams.findFirst({
        where: eq(teams.name, teamRole.name),
      });

      if (!team) {
        return interaction.reply('Invalid team: Make sure the team exists in the database');
      }

      // Fixed ELC values
      const salary = 925000; // $925,000
      const length = 210; // 30 weeks * 7 days

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
        .setTitle('Entry Level Contract Offer')
        .setDescription(`${user} has been offered an Entry Level Contract by ${teamRole}`)
        .addFields(
          { name: 'Salary', value: `$${salary.toLocaleString()}` },
          { name: 'Length', value: '30 weeks' },
        )
        .setFooter({ text: '✅ to accept, ❌ to decline' });

      const message = await interaction.reply({ 
        embeds: [embed],
        fetchReply: true,
      });

      // Add reactions for acceptance and denial
      await message.react('✅');
      await message.react('❌');
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('offer')
      .setDescription('Offer a custom contract to a player')
      .addUserOption(option => 
        option.setName('player')
          .setDescription('The player to offer the contract to')
          .setRequired(true))
      .addRoleOption(option =>
        option.setName('team')
          .setDescription('The team offering the contract (use @team)')
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
      const teamRole = interaction.options.getRole('team', true);
      const salary = interaction.options.getInteger('salary', true);
      const length = interaction.options.getInteger('length', true);

      // Validate team exists and has cap space
      const team = await db.query.teams.findFirst({
        where: eq(teams.name, teamRole.name),
      });

      if (!team) {
        return interaction.reply('Invalid team: Make sure the team exists in the database');
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
        .setDescription(`${user} has been offered a contract by ${teamRole}`)
        .addFields(
          { name: 'Salary', value: `$${salary.toLocaleString()}` },
          { name: 'Length', value: `${length} days` },
        )
        .setFooter({ text: '✅ to accept, ❌ to decline' });

      const message = await interaction.reply({ 
        embeds: [embed],
        fetchReply: true,
      });

      // Add reactions for acceptance and denial
      await message.react('✅');
      await message.react('❌');
    },
  },
];