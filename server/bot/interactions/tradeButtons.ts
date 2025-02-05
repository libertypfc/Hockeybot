import { ButtonInteraction, EmbedBuilder, ButtonStyle, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { db } from '@db';
import { tradeProposals, tradeAdminSettings, players, teams, contracts } from '@db/schema';
import { eq, and, sql } from 'drizzle-orm';

export async function handleTradeButtons(interaction: ButtonInteraction) {
  const [action, proposalId] = interaction.customId.split(':');

  if (!proposalId) {
    await interaction.reply({
      content: 'Invalid trade proposal',
      ephemeral: true
    });
    return;
  }

  try {
    const proposal = await db.query.tradeProposals.findFirst({
      where: eq(tradeProposals.id, parseInt(proposalId)),
      with: {
        fromTeam: true,
        toTeam: true,
        player: true,
      },
    });

    if (!proposal) {
      await interaction.reply({
        content: 'Trade proposal not found',
        ephemeral: true
      });
      return;
    }

    // Get active contract
    const activeContract = await db.query.contracts.findFirst({
      where: and(
        eq(contracts.playerId, proposal.playerId),
        eq(contracts.status, 'active')
      ),
    });

    if (!activeContract) {
      await interaction.reply({
        content: 'Player contract not found',
        ephemeral: true
      });
      return;
    }

    switch (action) {
      case 'accept_trade':
        // Check if user has permission to accept
        const hasPermission = interaction.guild?.roles.cache
          .find(role => role.name === proposal.toTeam.name)?.id === 
          interaction.member?.roles.cache.find(role => role.name === proposal.toTeam.name)?.id;

        if (!hasPermission) {
          await interaction.reply({
            content: 'You do not have permission to accept this trade',
            ephemeral: true
          });
          return;
        }

        // Update proposal status
        await db.update(tradeProposals)
          .set({ status: 'accepted' })
          .where(eq(tradeProposals.id, proposal.id));

        // Send to admin channel
        const settings = await db.query.tradeAdminSettings.findFirst({
          where: eq(tradeAdminSettings.guildId, interaction.guildId!),
        });

        if (!settings) {
          await interaction.reply({
            content: 'Admin channel not configured',
            ephemeral: true
          });
          return;
        }

        const adminChannel = await interaction.guild?.channels.fetch(settings.adminChannelId);
        if (!adminChannel?.isTextBased()) {
          await interaction.reply({
            content: 'Admin channel not found',
            ephemeral: true
          });
          return;
        }

        const adminEmbed = new EmbedBuilder()
          .setTitle('🔄 Trade Pending Approval')
          .setDescription(`Trade between ${proposal.fromTeam.name} and ${proposal.toTeam.name}`)
          .addFields(
            { name: 'Player', value: `<@${proposal.player.discordId}>`, inline: true },
            { name: 'From', value: proposal.fromTeam.name, inline: true },
            { name: 'To', value: proposal.toTeam.name, inline: true },
            { name: 'Salary', value: `$${activeContract.salary.toLocaleString()}`, inline: true },
            { name: 'Status', value: proposal.player.salaryExempt ? '🏷️ Salary Exempt' : '💰 Counts Against Cap', inline: true }
          )
          .setTimestamp();

        const approveButton = new ButtonBuilder()
          .setCustomId(`approve_trade:${proposal.id}`)
          .setLabel('Approve Trade')
          .setStyle(ButtonStyle.Success);

        const rejectButton = new ButtonBuilder()
          .setCustomId(`reject_trade:${proposal.id}`)
          .setLabel('Reject Trade')
          .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder<ButtonBuilder>()
          .addComponents(approveButton, rejectButton);

        const adminMessage = await adminChannel.send({
          content: '@here Trade pending approval',
          embeds: [adminEmbed],
          components: [row],
        });

        // Update proposal with admin message ID
        await db.update(tradeProposals)
          .set({ adminMessageId: adminMessage.id })
          .where(eq(tradeProposals.id, proposal.id));

        await interaction.update({
          content: 'Trade accepted and sent for admin approval',
          components: [],
        });
        break;

      case 'reject_trade':
        // Check if user has permission to reject
        const canReject = interaction.guild?.roles.cache
          .find(role => role.name === proposal.toTeam.name)?.id === 
          interaction.member?.roles.cache.find(role => role.name === proposal.toTeam.name)?.id;

        if (!canReject) {
          await interaction.reply({
            content: 'You do not have permission to reject this trade',
            ephemeral: true
          });
          return;
        }

        // Update proposal status
        await db.update(tradeProposals)
          .set({ status: 'rejected' })
          .where(eq(tradeProposals.id, proposal.id));

        await interaction.update({
          content: 'Trade rejected',
          components: [],
        });
        break;

      case 'approve_trade':
        // Only process if in admin channel
        const adminSettings = await db.query.tradeAdminSettings.findFirst({
          where: eq(tradeAdminSettings.guildId, interaction.guildId!),
        });

        if (!adminSettings || interaction.channelId !== adminSettings.adminChannelId) {
          await interaction.reply({
            content: 'This action can only be performed in the admin channel',
            ephemeral: true
          });
          return;
        }

        // Process the trade
        if (!proposal.player.salaryExempt) {
          // Update cap space
          await db.update(teams)
            .set({
              availableCap: sql`${teams.availableCap} + ${activeContract.salary}`,
            })
            .where(eq(teams.id, proposal.fromTeamId));

          await db.update(teams)
            .set({
              availableCap: sql`${teams.availableCap} - ${activeContract.salary}`,
            })
            .where(eq(teams.id, proposal.toTeamId));
        }

        // Update player's team
        await db.update(players)
          .set({ currentTeamId: proposal.toTeamId })
          .where(eq(players.id, proposal.playerId));

        // Update contract
        await db.update(contracts)
          .set({ teamId: proposal.toTeamId })
          .where(eq(contracts.id, activeContract.id));

        // Update Discord roles
        const member = await interaction.guild?.members.fetch(proposal.player.discordId);
        if (member) {
          const fromTeamRole = interaction.guild?.roles.cache.find(
            (role): role is Role => role.name === proposal.fromTeam.name
          );
          const toTeamRole = interaction.guild?.roles.cache.find(
            (role): role is Role => role.name === proposal.toTeam.name
          );

          if (fromTeamRole) await member.roles.remove(fromTeamRole);
          if (toTeamRole) await member.roles.add(toTeamRole);
        }

        // Update proposal status
        await db.update(tradeProposals)
          .set({ status: 'admin_approved' })
          .where(eq(tradeProposals.id, proposal.id));

        await interaction.update({
          content: 'Trade approved and processed',
          components: [],
        });
        break;

      case 'reject_trade_admin':
        // Only process if in admin channel
        const rejectAdminSettings = await db.query.tradeAdminSettings.findFirst({
          where: eq(tradeAdminSettings.guildId, interaction.guildId!),
        });

        if (!rejectAdminSettings || interaction.channelId !== rejectAdminSettings.adminChannelId) {
          await interaction.reply({
            content: 'This action can only be performed in the admin channel',
            ephemeral: true
          });
          return;
        }

        // Update proposal status
        await db.update(tradeProposals)
          .set({ status: 'admin_rejected' })
          .where(eq(tradeProposals.id, proposal.id));

        await interaction.update({
          content: 'Trade rejected by admin',
          components: [],
        });
        break;
    }
  } catch (error) {
    console.error('Error handling trade button:', error);
    await interaction.reply({
      content: 'An error occurred while processing the trade',
      ephemeral: true
    });
  }
}