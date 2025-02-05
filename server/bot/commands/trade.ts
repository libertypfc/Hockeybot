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
      .setDescription('Propose a trade to another team')
      .addRoleOption(option =>
        option.setName('to_team')
          .setDescription('Team to propose trade to')
          .setRequired(true))
      .addUserOption(option =>
        option.setName('player')
          .setDescription('Player to trade')
          .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const toTeamRole = interaction.options.getRole('to_team', true);
        const user = interaction.options.getUser('player', true);

        // Check if user is a GM
        const isGM = interaction.guild?.roles.cache.some(role =>
          role.name.includes('GM') || role.name.includes('General Manager')
        );

        if (!isGM) {
          return interaction.editReply('You must be a GM to propose trades');
        }

        // Get the user's team role
        const fromTeamRole = interaction.guild?.roles.cache.find(role =>
          interaction.member?.roles.cache.has(role.id) &&
          !role.name.includes('GM') &&
          !role.name.includes('General Manager')
        );

        if (!fromTeamRole) {
          return interaction.editReply('Could not determine your team role');
        }

        // Get both teams
        const fromTeam = await db.query.teams.findFirst({
          where: eq(teams.name, fromTeamRole.name),
        });

        const toTeam = await db.query.teams.findFirst({
          where: eq(teams.name, toTeamRole.name),
        });

        if (!fromTeam || !toTeam) {
          return interaction.editReply('Invalid team name(s)');
        }

        // Get player and their active contract
        const player = await db.query.players.findFirst({
          where: and(
            eq(players.discordId, user.id),
            eq(players.currentTeamId, fromTeam.id)
          ),
        });

        if (!player) {
          return interaction.editReply('Player not found or not on your team');
        }

        // Get active contract
        const activeContract = await db.query.contracts.findFirst({
          where: and(
            eq(contracts.playerId, player.id),
            eq(contracts.status, 'active')
          ),
        });

        if (!activeContract) {
          return interaction.editReply('Player does not have an active contract');
        }

        // Create trade proposal
        const [proposal] = await db.insert(tradeProposals)
          .values({
            fromTeamId: fromTeam.id,
            toTeamId: toTeam.id,
            playerId: player.id,
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
          .setDescription(`${fromTeam.name} wants to trade ${user} to ${toTeam.name}`)
          .addFields(
            { name: 'Player', value: user.tag, inline: true },
            { name: 'From Team', value: fromTeam.name, inline: true },
            { name: 'To Team', value: toTeam.name, inline: true },
            { name: 'Salary', value: `$${activeContract.salary.toLocaleString()}`, inline: true },
            { name: 'Status', value: player.salaryExempt ? '🏷️ Salary Exempt' : '💰 Counts Against Cap', inline: true }
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