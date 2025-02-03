import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction, Role } from 'discord.js';
import { db } from '@db';
import { players, contracts, teams } from '@db/schema';
import { eq } from 'drizzle-orm';

export const ContractCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('offer')
      .setDescription('Offer different types of contracts')
      .addSubcommand(subcommand =>
        subcommand
          .setName('elc')
          .setDescription('Offer an Entry Level Contract to a player')
          .addUserOption(option => 
            option.setName('player')
              .setDescription('The player to offer the ELC to')
              .setRequired(true))
          .addRoleOption(option =>
            option.setName('team')
              .setDescription('The team offering the contract (use @team)')
              .setRequired(true)))
      .addSubcommand(subcommand =>
        subcommand
          .setName('custom')
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
              .setRequired(true))),

    async execute(interaction: ChatInputCommandInteraction) {
      const subcommand = interaction.options.getSubcommand();
      const user = interaction.options.getUser('player', true);
      const teamRole = interaction.options.getRole('team', true);

      // Validate team exists and has cap space
      const team = await db.query.teams.findFirst({
        where: eq(teams.name, teamRole.name),
      });

      if (!team) {
        return interaction.reply('Invalid team: Make sure the team exists in the database');
      }

      let salary: number;
      let length: number;
      let title: string;
      let lengthDisplay: string;

      if (subcommand === 'elc') {
        // Fixed ELC values
        salary = 925000; // $925,000
        length = 210; // 30 weeks * 7 days
        title = 'Entry Level Contract Offer';
        lengthDisplay = '30 weeks';
      } else {
        // Custom contract values
        salary = interaction.options.getInteger('salary', true);
        length = interaction.options.getInteger('length', true);
        title = 'Contract Offer';
        lengthDisplay = `${length} days`;
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
        .setTitle(title)
        .setDescription(`${user} has been offered a contract by ${teamRole}`)
        .addFields(
          { name: 'Salary', value: `$${salary.toLocaleString()}` },
          { name: 'Length', value: lengthDisplay },
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