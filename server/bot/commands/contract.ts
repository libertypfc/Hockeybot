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
              .setDescription('Contract length in weeks')
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(52))),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const subcommand = interaction.options.getSubcommand();
        const user = interaction.options.getUser('player');
        const teamRole = interaction.options.getRole('team');

        if (!user || !teamRole) {
          return interaction.editReply('Both player and team are required');
        }

        // Validate team exists and has cap space
        const team = await db.select({
          id: teams.id,
          name: teams.name,
          salary_cap: teams.salary_cap,
          available_cap: teams.available_cap,
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
          // Custom contract
          const salaryInput = interaction.options.getInteger('salary', true);
          const weeksInput = interaction.options.getInteger('length', true);

          salary = salaryInput * 1_000_000; // Convert millions to actual dollars
          length = weeksInput * 7; // Convert weeks to days
          title = 'Contract Offer';
          lengthDisplay = `${weeksInput} week${weeksInput !== 1 ? 's' : ''}`;
        }

        const availableCap = team.available_cap ?? 0;
        if (availableCap < salary) {
          return interaction.editReply('Team does not have enough cap space');
        }

        // Create or get player
        let player = await db.query.players.findFirst({
          where: eq(players.discordId, user.id),
          columns: {
            id: true,
            username: true,
            welcomeMessageSent: true,
          },
        });

        if (!player) {
          // Create new player with required fields
          const [newPlayer] = await db.insert(players)
            .values({
              discordId: user.id,
              username: user.username,
              welcomeMessageSent: false,
              status: 'free_agent',
              salaryExempt: false,
            })
            .returning({
              id: players.id,
              username: players.username,
              welcomeMessageSent: players.welcomeMessageSent,
            });

          player = newPlayer;
        }

        if (!player) {
          return interaction.editReply('Failed to create or find player record');
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
        expirationDate.setHours(expirationDate.getHours() + 24);

        const [contract] = await db.insert(contracts)
          .values({
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
          })
          .returning();

        if (!contract) {
          return interaction.editReply('Failed to create contract offer');
        }

        // Create embed for contract offer
        const embed = new EmbedBuilder()
          .setTitle(title)
          .setDescription(`${user} has been offered a contract by ${teamRole}\nOffer expires <t:${Math.floor(expirationDate.getTime() / 1000)}:R>`)
          .addFields(
            { name: 'Salary', value: `$${salary.toLocaleString()}` },
            { name: 'Length', value: lengthDisplay },
          )
          .setFooter({ text: '✅ to accept, ❌ to decline' });

        // Send DM notification to player
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

          // Send the initial reply to get the message URL
          const replyMessage = await interaction.editReply({
            content: `Contract offer sent to ${user}. They have been notified via DM.`,
            embeds: [embed],
          });

          // Add message URL to the DM embed
          const messageUrl = replyMessage.url;
          if (messageUrl) {
            dmEmbed.addFields({
              name: 'Contract Location',
              value: `[Click here to view the contract offer](${messageUrl})`,
              inline: false
            });
          }

          await user.send({ embeds: [dmEmbed] });

          // Add reactions after sending the DM
          await replyMessage.react('✅');
          await replyMessage.react('❌');

          // Update contract metadata with message ID
          if ('id' in replyMessage) {
            await db.update(contracts)
              .set({
                metadata: JSON.stringify({
                  expiresAt: expirationDate.toISOString(),
                  offerMessageId: replyMessage.id,
                }),
              })
              .where(eq(contracts.id, contract.id));
          }

        } catch (error) {
          console.warn(`Could not send DM to ${user.tag}`, error);
        }


      } catch (error) {
        console.error('Error in contract offer command:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to create contract offer: ${errorMessage}`);
      }
    },
  },
];