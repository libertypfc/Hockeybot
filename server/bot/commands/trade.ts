import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, Role } from 'discord.js';
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
          .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const channel = interaction.options.getChannel('channel', true);
        const guild = interaction.guild;

        if (!guild) {
          return interaction.editReply('This command must be used in a server.');
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

        await interaction.editReply(`Trade admin channel has been set to ${channel}`);
      } catch (error) {
        console.error('Error setting up trade admin channel:', error);
        await interaction.editReply('Failed to set up trade admin channel');
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
  {
    data: new SlashCommandBuilder()
      .setName('trade')
      .setDescription('Trade a player between teams')
      .addRoleOption(option =>
        option.setName('from_team')
          .setDescription('Team trading the player (use @team)')
          .setRequired(true))
      .addUserOption(option =>
        option.setName('player')
          .setDescription('Player being traded')
          .setRequired(true))
      .addRoleOption(option =>
        option.setName('to_team')
          .setDescription('Team receiving the player (use @team)')
          .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const fromTeamRole = interaction.options.getRole('from_team', true);
        const toTeamRole = interaction.options.getRole('to_team', true);
        const user = interaction.options.getUser('player', true);

        // Get both teams with their cap information
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
          return interaction.editReply('Player not found or not on the trading team');
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

        // Calculate salary impact
        const playerSalary = activeContract.salary;

        // Check if receiving team has enough cap space
        if (!player.salaryExempt && (toTeam.availableCap ?? 0) < playerSalary) {
          return interaction.editReply(`${toTeamRole} does not have enough cap space for this trade. They need $${playerSalary.toLocaleString()} in space.`);
        }

        // Update team cap space only if player is not salary exempt
        if (!player.salaryExempt) {
          // Give cap space back to trading team
          await db.update(teams)
            .set({
              availableCap: sql`${teams.availableCap} + ${playerSalary}`,
            })
            .where(eq(teams.id, fromTeam.id));

          // Remove cap space from receiving team
          await db.update(teams)
            .set({
              availableCap: sql`${teams.availableCap} - ${playerSalary}`,
            })
            .where(eq(teams.id, toTeam.id));
        }

        // Update player's team and contract
        await db.update(players)
          .set({ currentTeamId: toTeam.id })
          .where(eq(players.id, player.id));

        await db.update(contracts)
          .set({ teamId: toTeam.id })
          .where(eq(contracts.id, activeContract.id));

        // Update Discord roles
        const member = await interaction.guild?.members.fetch(user.id);
        if (member) {
          await member.roles.remove(fromTeamRole);
          await member.roles.add(toTeamRole);
        }

        const tradeEmbed = new EmbedBuilder()
          .setTitle('🔄 Trade Completed')
          .setDescription(`${user} has been traded from ${fromTeamRole} to ${toTeamRole}`)
          .addFields(
            { name: 'Salary', value: `$${playerSalary.toLocaleString()}`, inline: true },
            { name: 'Status', value: player.salaryExempt ? '🏷️ Salary Exempt' : '💰 Counts Against Cap', inline: true },
            { name: `${fromTeam.name} Cap Space`, value: `$${(fromTeam.availableCap! + (player.salaryExempt ? 0 : playerSalary)).toLocaleString()}`, inline: true },
            { name: `${toTeam.name} Cap Space`, value: `$${(toTeam.availableCap! - (player.salaryExempt ? 0 : playerSalary)).toLocaleString()}`, inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [tradeEmbed] });
      } catch (error) {
        console.error('[Error] Error processing trade:', error);
        await interaction.editReply('Failed to process trade. Please try again.');
      }
    },
  },
];