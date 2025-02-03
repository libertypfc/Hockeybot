import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';
import { db } from '@db';
import { players, contracts, teams } from '@db/schema';
import { eq } from 'drizzle-orm';

async function sendWelcomeMessage(user: any, teamRole: any) {
  const welcomeEmbed = new EmbedBuilder()
    .setTitle('🏒 Welcome to the Hockey League!')
    .setDescription(
      `Hello ${user}, welcome to our hockey league! You've been offered a contract by ${teamRole}.\n\n` +
      `Here's what you need to know:\n` +
      `• Your stats will be tracked through our system\n` +
      `• You can view your stats and performance on our web dashboard\n` +
      `• Contract offers will be sent to you directly\n` +
      `• Use reactions (✅/❌) to accept or decline contracts\n\n` +
      `Good luck and have fun! 🎮`
    )
    .setColor('#4ade80')
    .setTimestamp();

  try {
    await user.send({ embeds: [welcomeEmbed] });
  } catch (error) {
    console.warn(`Could not send welcome DM to ${user.tag}`, error);
  }
}

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
        const team = await db.select({
          id: teams.id,
          name: teams.name,
          salaryCap: teams.salaryCap,
          availableCap: teams.availableCap,
        })
        .from(teams)
        .where(eq(teams.name, teamRole.name))
        .then(rows => rows[0]);

        if (!team) {
          return interaction.editReply('Invalid team: Make sure the team exists in the database');
        }

        let salary: number;
        let length: number;
        let title: string;
        let lengthDisplay: string;

        if (subcommand === 'elc') {
          salary = 925000; // $925,000
          length = 210; // 30 weeks * 7 days
          title = 'Entry Level Contract Offer';
          lengthDisplay = '30 weeks';
        } else {
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
        let player = await db.select({
          id: players.id,
          username: players.username,
          welcomeMessageSent: players.welcomeMessageSent,
        })
        .from(players)
        .where(eq(players.discordId, user.id))
        .then(rows => rows[0]);

        if (!player) {
          const result = await db.insert(players).values({
            discordId: user.id,
            username: user.username,
            welcomeMessageSent: false
          }).returning();
          player = result[0];
        }

        // Send welcome message to new players
        if (!player.welcomeMessageSent) {
          await sendWelcomeMessage(user, teamRole);
          await db.update(players)
            .set({ welcomeMessageSent: true })
            .where(eq(players.id, player.id));
        }

        // Create contract with expiration time (24 hours from now)
        const startDate = new Date();
        const endDate = new Date();
        const expirationDate = new Date();
        endDate.setDate(endDate.getDate() + length);
        expirationDate.setHours(expirationDate.getHours() + 24); // Contract offer expires in 24 hours

        const contract = await db.insert(contracts).values({
          playerId: player.id,
          teamId: team.id,
          salary,
          lengthInDays: length,
          startDate,
          endDate,
          status: 'pending',
          metadata: JSON.stringify({
            expiresAt: expirationDate.toISOString(),
            offerMessageId: '', // Will be updated after sending the message
          }),
        }).returning();

        // Create embed for contract offer
        const embed = new EmbedBuilder()
          .setTitle(title)
          .setDescription(`${user} has been offered a contract by ${teamRole}\nOffer expires <t:${Math.floor(expirationDate.getTime() / 1000)}:R>`)
          .addFields(
            { name: 'Salary', value: `$${salary.toLocaleString()}` },
            { name: 'Length', value: lengthDisplay },
          )
          .setFooter({ text: '✅ to accept, ❌ to decline' });

        // First send a direct notification to the player
        try {
          const dmEmbed = new EmbedBuilder()
            .setTitle('🏒 New Contract Offer!')
            .setDescription(
              `You have received a ${subcommand === 'elc' ? 'new Entry Level Contract' : 'contract'} offer from ${teamRole}!\n` +
              `Offer expires <t:${Math.floor(expirationDate.getTime() / 1000)}:R>`
            )
            .addFields(
              { name: 'Team', value: team.name },
              { name: 'Salary', value: `$${salary.toLocaleString()}` },
              { name: 'Length', value: lengthDisplay },
            )
            .setFooter({ text: 'Check the offer in the server and react with ✅ to accept or ❌ to decline' });

          await user.send({ embeds: [dmEmbed] });
        } catch (error) {
          console.warn(`Could not send DM to ${user.tag}`, error);
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

          // Update the contract with the message ID for future reference
          if ('id' in replyMessage && contract[0]) {
            await db.update(contracts)
              .set({
                metadata: JSON.stringify({
                  expiresAt: expirationDate.toISOString(),
                  offerMessageId: replyMessage.id,
                }),
              })
              .where(eq(contracts.id, contract[0].id));
          }
        }

      } catch (error) {
        console.error('Error in contract offer command:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to create contract offer: ${errorMessage}`);
      }
    },
  },
];