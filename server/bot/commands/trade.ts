import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, Role, ChannelType, PermissionFlagsBits } from 'discord.js';
import { db } from '@db';
import { players, teams, contracts, tradeProposals, tradeAdminSettings } from '@db/schema';
import { eq, and, sql } from 'drizzle-orm';

export const TradeCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('setuptradechannel')
      .setDescription('Set up trade admin channel for approvals')
      .addChannelOption(option =>
        option.setName('channel')
          .setDescription('Admin channel for trade approvals')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const channel = interaction.options.getChannel('channel', true);
        const guild = interaction.guild;

        if (!guild) {
          return interaction.editReply('This command must be used in a server.');
        }

        if (!channel.isTextBased()) {
          return interaction.editReply('The channel must be a text channel.');
        }

        // Save or update settings
        await db.insert(tradeAdminSettings)
          .values({
            guildId: guild.id,
            adminChannelId: channel.id,
          })
          .onConflictDoUpdate({
            target: tradeAdminSettings.guildId,
            set: {
              adminChannelId: channel.id,
            },
          });

        await interaction.editReply({
          content: `✅ Trade admin channel has been set to ${channel}\nGMs can now use \`/proposetrade\` to initiate trades.`,
          allowedMentions: { users: [], roles: [] }
        });
      } catch (error) {
        console.error('[Error] Failed to set up trade admin channel:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to set up trade admin channel: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('proposetrade')
      .setDescription('Propose a trade between two teams')
      .addRoleOption(option =>
        option.setName('team_sending')
          .setDescription('Team sending a player')
          .setRequired(true))
      .addUserOption(option =>
        option.setName('player_sending')
          .setDescription('Player being sent')
          .setRequired(true))
      .addRoleOption(option =>
        option.setName('team_receiving')
          .setDescription('Team receiving a player')
          .setRequired(true))
      .addUserOption(option =>
        option.setName('player_receiving')
          .setDescription('Player being received')
          .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const teamSendingRole = interaction.options.getRole('team_sending', true);
        const playerSending = interaction.options.getUser('player_sending', true);
        const teamReceivingRole = interaction.options.getRole('team_receiving', true);
        const playerReceiving = interaction.options.getUser('player_receiving', true);

        // Check if user is a GM
        const isGM = interaction.guild?.roles.cache.some(role =>
          role.name.includes('GM') || role.name.includes('General Manager')
        );

        if (!isGM) {
          return interaction.editReply('You must be a GM to propose trades');
        }

        // Get both teams from database
        const teamSending = await db.query.teams.findFirst({
          where: eq(teams.name, teamSendingRole.name),
        });

        const teamReceiving = await db.query.teams.findFirst({
          where: eq(teams.name, teamReceivingRole.name),
        });

        if (!teamSending || !teamReceiving) {
          return interaction.editReply('Invalid team name(s)');
        }

        // Get players and their active contracts
        const playerSendingData = await db.query.players.findFirst({
          where: and(
            eq(players.discordId, playerSending.id),
            eq(players.currentTeamId, teamSending.id)
          ),
        });

        const playerReceivingData = await db.query.players.findFirst({
          where: and(
            eq(players.discordId, playerReceiving.id),
            eq(players.currentTeamId, teamReceiving.id)
          ),
        });

        if (!playerSendingData || !playerReceivingData) {
          return interaction.editReply('One or both players not found or not on the specified teams');
        }

        // Get active contracts
        const contractSending = await db.query.contracts.findFirst({
          where: and(
            eq(contracts.playerId, playerSendingData.id),
            eq(contracts.status, 'active')
          ),
        });

        const contractReceiving = await db.query.contracts.findFirst({
          where: and(
            eq(contracts.playerId, playerReceivingData.id),
            eq(contracts.status, 'active')
          ),
        });

        if (!contractSending || !contractReceiving) {
          return interaction.editReply('One or both players do not have active contracts');
        }

        // Create trade proposal
        const [proposal] = await db.insert(tradeProposals)
          .values({
            fromTeamId: teamSending.id,
            toTeamId: teamReceiving.id,
            playerId: playerSendingData.id,
            playerReceivingId: playerReceivingData.id,
            status: 'pending',
          })
          .returning();

        // Create buttons
        const acceptButton = new ButtonBuilder()
          .setCustomId(`accept_trade:${proposal.id}`)
          .setLabel('Accept Trade')
          .setStyle(ButtonStyle.Success);

        const rejectButton = new ButtonBuilder()
          .setCustomId(`reject_trade:${proposal.id}`)
          .setLabel('Reject Trade')
          .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder<ButtonBuilder>()
          .addComponents(acceptButton, rejectButton);

        // Create embed for trade proposal
        const proposalEmbed = new EmbedBuilder()
          .setTitle('🔄 Trade Proposal')
          .setDescription(`${teamSending.name} and ${teamReceiving.name} Trade Proposal`)
          .addFields(
            { 
              name: `${teamSending.name} Sends:`, 
              value: `${playerSending}\nSalary: $${contractSending.salary.toLocaleString()}\nStatus: ${playerSendingData.salaryExempt ? '🏷️ Salary Exempt' : '💰 Counts Against Cap'}`,
              inline: true 
            },
            { name: '\u200B', value: '\u200B', inline: true },
            { 
              name: `${teamReceiving.name} Sends:`, 
              value: `${playerReceiving}\nSalary: $${contractReceiving.salary.toLocaleString()}\nStatus: ${playerReceivingData.salaryExempt ? '🏷️ Salary Exempt' : '💰 Counts Against Cap'}`,
              inline: true 
            }
          )
          .setTimestamp();

        const reply = await interaction.editReply({
          embeds: [proposalEmbed],
          components: [row],
        });

        // Store message ID for reference
        await db.update(tradeProposals)
          .set({ messageId: reply.id })
          .where(eq(tradeProposals.id, proposal.id));

      } catch (error) {
        console.error('Error proposing trade:', error);
        await interaction.editReply('Failed to propose trade');
      }
    },
  },
];