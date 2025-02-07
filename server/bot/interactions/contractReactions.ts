import { MessageReaction, User } from 'discord.js';
import { db } from '@db';
import { contracts, players, teams } from '@db/schema';
import { eq, and } from 'drizzle-orm';
import { EmbedBuilder } from 'discord.js';
import { sql } from 'drizzle-orm';

interface ContractMetadata {
  expiresAt: string;
  offerMessageId: string;
  acceptedAt?: string;
  rejectedAt?: string;
}

export async function handleContractReactions(reaction: MessageReaction, user: User) {
  try {
    // Only handle checkmark and x reactions
    if (!['✅', '❌'].includes(reaction.emoji.name ?? '')) {
      return;
    }

    // Fetch the full message if needed
    const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;

    // Find contract with this message ID
    const contract = await db.query.contracts.findFirst({
      where: sql`${contracts.metadata}->>'offerMessageId' = ${message.id}`,
      with: {
        player: true,
        team: true,
      }
    });

    if (!contract) {
      console.log('No contract found for message ID:', message.id);
      return;
    }

    // Parse metadata
    const metadata = JSON.parse(contract.metadata || '{}') as ContractMetadata;

    // Verify the user reacting is the player who received the offer
    if (contract.player.discordId !== user.id) {
      await reaction.users.remove(user);
      return;
    }

    if (reaction.emoji.name === '✅') {
      // Accept contract
      await db.update(contracts)
        .set({
          status: 'active',
          metadata: JSON.stringify({
            ...metadata,
            acceptedAt: new Date().toISOString(),
          }),
        })
        .where(eq(contracts.id, contract.id));

      // Update player status and team
      await db.update(players)
        .set({
          currentTeamId: contract.teamId,
          status: 'signed',
        })
        .where(eq(players.id, contract.playerId));

      // Update team's available cap if player is not salary exempt
      if (!contract.player.salaryExempt) {
        await db.update(teams)
          .set({
            available_cap: sql`${teams.available_cap} - ${contract.salary}`
          })
          .where(eq(teams.id, contract.teamId));
      }

      // Create acceptance embed
      const acceptEmbed = new EmbedBuilder()
        .setTitle('Contract Accepted ✅')
        .setDescription(`<@${contract.player.discordId}> has accepted the contract offer from ${contract.team.name}`)
        .addFields(
          { name: 'Salary', value: `$${contract.salary.toLocaleString()}`, inline: true },
          { name: 'Length', value: `${Math.floor(contract.lengthInDays / 7)} weeks`, inline: true }
        )
        .setColor('#00FF00')
        .setTimestamp();

      await message.edit({
        embeds: [acceptEmbed],
        components: []
      });

      // Update Discord roles
      if (message.guild) {
        try {
          const member = await message.guild.members.fetch(user.id);
          const teamRole = message.guild.roles.cache.find(role => role.name === contract.team.name);
          const freeAgentRole = message.guild.roles.cache.find(role => role.name === 'Free Agent');

          if (teamRole) {
            await member.roles.add(teamRole);
          }
          if (freeAgentRole) {
            await member.roles.remove(freeAgentRole);
          }
        } catch (error) {
          console.error('Error updating roles:', error);
        }
      }

    } else if (reaction.emoji.name === '❌') {
      // Reject contract
      await db.update(contracts)
        .set({
          status: 'rejected',
          metadata: JSON.stringify({
            ...metadata,
            rejectedAt: new Date().toISOString(),
          }),
        })
        .where(eq(contracts.id, contract.id));

      const rejectEmbed = new EmbedBuilder()
        .setTitle('Contract Rejected ❌')
        .setDescription(`<@${contract.player.discordId}> has rejected the contract offer from ${contract.team.name}`)
        .setColor('#FF0000')
        .setTimestamp();

      await message.edit({
        embeds: [rejectEmbed],
        components: []
      });
    }

    // Remove all reactions after processing
    await message.reactions.removeAll();

  } catch (error) {
    console.error('Error handling contract reaction:', error);
  }
}