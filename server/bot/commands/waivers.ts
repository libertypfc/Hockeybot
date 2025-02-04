import { SlashCommandBuilder, ChatInputCommandInteraction, ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { db } from '@db';
import { players, waivers, waiverSettings, teams, contracts } from '@db/schema';
import { eq, and } from 'drizzle-orm';

export const WaiversCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('setupwaivers')
      .setDescription('Set up waiver wire notification system')
      .addChannelOption(option =>
        option.setName('channel')
          .setDescription('Channel for waiver wire notifications')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true))
      .addRoleOption(option =>
        option.setName('scout_role')
          .setDescription('Role to be notified of waiver wire activity (Scouts)')
          .setRequired(true))
      .addRoleOption(option =>
        option.setName('gm_role')
          .setDescription('Role to be notified of waiver wire activity (GMs)')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const channel = interaction.options.getChannel('channel', true);
        const scoutRole = interaction.options.getRole('scout_role', true);
        const gmRole = interaction.options.getRole('gm_role', true);
        const guild = interaction.guild;

        if (!guild) {
          return interaction.editReply('This command must be used in a server.');
        }

        // Save or update settings
        await db.insert(waiverSettings)
          .values({
            guildId: guild.id,
            notificationChannelId: channel.id,
            scoutRoleId: scoutRole.id,
            gmRoleId: gmRole.id,
          })
          .onConflictDoUpdate({
            target: waiverSettings.guildId,
            set: {
              notificationChannelId: channel.id,
              scoutRoleId: scoutRole.id,
              gmRoleId: gmRole.id,
            },
          });

        await interaction.editReply({
          content: `Waiver wire notification system has been set up:\n` +
            `📢 Notifications will be sent to ${channel}\n` +
            `👥 Notification roles configured:\n` +
            `• ${scoutRole} - Scout notifications\n` +
            `• ${gmRole} - GM notifications\n`,
        });

      } catch (error) {
        console.error('Error setting up waiver system:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to set up waiver system: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('clearwaivers')
      .setDescription('Remove waiver wire notification settings')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const guild = interaction.guild;

        if (!guild) {
          return interaction.editReply('This command must be used in a server.');
        }

        // Delete settings
        await db.delete(waiverSettings)
          .where(eq(waiverSettings.guildId, guild.id));

        await interaction.editReply('Waiver wire notification settings have been cleared.');

      } catch (error) {
        console.error('Error clearing waiver settings:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to clear waiver settings: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('pingwaivers')
      .setDescription('Test waiver wire notification system')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const guild = interaction.guild;

        if (!guild) {
          return interaction.editReply('This command must be used in a server.');
        }

        // Get waiver notification settings
        const settings = await db.query.waiverSettings.findFirst({
          where: eq(waiverSettings.guildId, guild.id),
        });

        if (!settings) {
          return interaction.editReply('Waiver wire notification settings not found. Use /setupwaivers first.');
        }

        // Get the notification channel
        const notificationChannel = await guild.channels.fetch(settings.notificationChannelId);
        if (!notificationChannel?.isTextBased()) {
          return interaction.editReply('Notification channel not found or is not a text channel.');
        }

        // Send a test notification
        const testEmbed = new EmbedBuilder()
          .setTitle('🏒 Waiver Wire Notification Test')
          .setDescription('This is a test of the waiver wire notification system.')
          .setTimestamp();

        await notificationChannel.send({
          content: `**🚨 Test Notification**\n<@&${settings.scoutRoleId}> <@&${settings.gmRoleId}>\nThis is a test of the waiver wire notification system.`,
          embeds: [testEmbed],
        });

        await interaction.editReply('Test notification sent to the configured channel.');

      } catch (error) {
        console.error('Error sending test notification:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to send test notification: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('release')
      .setDescription('Release a player to waivers')
      .addUserOption(option =>
        option.setName('player')
          .setDescription('The player to release')
          .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const user = interaction.options.getUser('player', true);

        // Get player, their current team, and active contract
        const player = await db.query.players.findFirst({
          where: eq(players.discordId, user.id),
          with: {
            currentTeam: true,
            contracts: {
              where: eq(contracts.status, 'active'),
            },
          },
        });

        if (!player || !player.currentTeam) {
          return interaction.editReply('Player is not signed to any team');
        }

        const activeContract = player.contracts[0];
        if (!activeContract) {
          return interaction.editReply('Player does not have an active contract');
        }

        // Calculate waiver period
        const startTime = new Date();
        const endTime = new Date();
        endTime.setHours(endTime.getHours() + 48); // 48 hour default period

        // Create waiver entry with contract information
        await db.insert(waivers).values({
          playerId: player.id,
          fromTeamId: player.currentTeamId!,
          startTime,
          endTime,
          contractId: activeContract.id,
          salary: activeContract.salary, // Store the salary with the waiver entry
        });

        // Remove team role but keep the salary with the team
        const member = await interaction.guild?.members.fetch(user.id);
        const teamRole = interaction.guild?.roles.cache.find(
          role => role.name === player.currentTeam?.name
        );

        if (teamRole && member) {
          await member.roles.remove(teamRole);
        }

        // Update player status but keep contract and salary with original team
        await db.update(players)
          .set({
            currentTeamId: null,
            status: 'waivers'
          })
          .where(eq(players.id, player.id));

        // Get waiver notification settings
        const settings = await db.query.waiverSettings.findFirst({
          where: eq(waiverSettings.guildId, interaction.guildId!),
        });

        // Create waiver notification embed
        const waiverEmbed = new EmbedBuilder()
          .setTitle('🚨 Player Added to Waivers')
          .setDescription(`${user} has been placed on waivers by ${player.currentTeam.name}`)
          .addFields(
            { name: 'Waiver Period', value: `Ends <t:${Math.floor(endTime.getTime() / 1000)}:R>` },
            { name: 'Salary', value: `$${activeContract.salary.toLocaleString()}` },
            { name: 'Status', value: player.salaryExempt ? '🏷️ Salary Exempt' : '💰 Counts Against Cap' }
          )
          .setTimestamp();

        // Send notification if channel is configured
        if (settings) {
          const notificationChannel = await interaction.guild?.channels.fetch(settings.notificationChannelId);
          if (notificationChannel?.isTextBased()) {
            await notificationChannel.send({
              content: `**🚨 Waiver Wire Alert!**\n<@&${settings.scoutRoleId}> <@&${settings.gmRoleId}>\nA new player is available on waivers!`,
              embeds: [waiverEmbed],
            });
          }
        }

        await interaction.editReply({
          content: `${user} has been placed on waivers. They will clear in 48 hours if unclaimed.\nTheir salary of $${activeContract.salary.toLocaleString()} will remain with ${player.currentTeam.name} until claimed.`,
          embeds: [waiverEmbed],
        });

      } catch (error) {
        console.error('[Error] Error processing waiver release:', error);
        await interaction.editReply('Failed to release player to waivers. Please try again.');
      }
    },
  },
];