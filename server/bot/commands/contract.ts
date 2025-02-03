import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';
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
      await interaction.deferReply();

      try {
        const subcommand = interaction.options.getSubcommand();
        const user = interaction.options.getUser('player', true);
        const teamRole = interaction.options.getRole('team', true);

        // Validate team exists and has cap space
        const team = await db.query.teams.findFirst({
          where: eq(teams.name, teamRole.name),
        });

        if (!team) {
          return interaction.editReply('Invalid team: Make sure the team exists in the database');
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
          return interaction.editReply('Team does not have enough cap space');
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

        // First send a direct notification to the player
        try {
          const dmEmbed = new EmbedBuilder()
            .setTitle('🏒 New Contract Offer!')
            .setDescription(`You have received a ${subcommand === 'elc' ? 'new Entry Level Contract' : 'contract'} offer from ${teamRole}!`)
            .addFields(
              { name: 'Team', value: team.name },
              { name: 'Salary', value: `$${salary.toLocaleString()}` },
              { name: 'Length', value: lengthDisplay },
            )
            .setFooter({ text: 'Check the offer in the server and react with ✅ to accept or ❌ to decline' });

          await user.send({ embeds: [dmEmbed] });
        } catch (error) {
          console.warn(`Could not send DM to ${user.tag}`, error);
          // Don't return here, continue with the channel message
        }

        // Send the message in the channel and add reactions
        const replyMessage = await interaction.editReply({
          content: `Contract offer sent to ${user}. They have been notified via DM.`,
          embeds: [embed],
        });

        if ('react' in replyMessage) {
          // Add reactions immediately
          await Promise.all([
            replyMessage.react('✅'),
            replyMessage.react('❌'),
          ]);
        }

      } catch (error) {
        console.error('Error in contract offer command:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to create contract offer: ${errorMessage}`);
      }
    },
  },
];