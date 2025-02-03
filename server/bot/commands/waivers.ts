import { SlashCommandBuilder, ChatInputCommandInteraction, Role, ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { db } from '@db';
import { players, waivers, waiverSettings } from '@db/schema';
import { eq } from 'drizzle-orm';

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
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const channel = interaction.options.getChannel('channel', true);
        const guild = interaction.guild;

        if (!guild) {
          return interaction.editReply('This command must be used in a server.');
        }

        // Create or get Scout role
        let scoutRole = guild.roles.cache.find(role => role.name === 'Waiver Wire Scout');
        if (!scoutRole) {
          scoutRole = await guild.roles.create({
            name: 'Waiver Wire Scout',
            color: '#3498db', // Using hex code for blue
            reason: 'Role for waiver wire notifications',
          });
        }

        // Create or get GM role
        let gmRole = guild.roles.cache.find(role => role.name === 'GM');
        if (!gmRole) {
          gmRole = await guild.roles.create({
            name: 'GM',
            color: '#2ecc71', // Using hex code for green
            reason: 'Role for waiver wire notifications',
          });
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
            `👥 Notification roles created/configured:\n` +
            `• ${scoutRole} - Waiver Wire Scout\n` +
            `• ${gmRole} - GM\n\n` +
            `Users can be assigned these roles to receive notifications when players hit waivers.`,
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
      .setName('release')
      .setDescription('Release a player to waivers')
      .addUserOption(option =>
        option.setName('player')
          .setDescription('The player to release')
          .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
      const user = interaction.options.getUser('player', true);

      // Get player and their current team
      const player = await db.query.players.findFirst({
        where: eq(players.discordId, user.id),
        with: {
          currentTeam: true,
        },
      });

      if (!player || !player.currentTeam) {
        return interaction.reply('Player is not signed to any team');
      }

      // Calculate waiver period
      const startTime = new Date();
      const endTime = new Date();
      endTime.setHours(endTime.getHours() + 48); // 48 hour default period

      // Create waiver entry
      await db.insert(waivers).values({
        playerId: player.id,
        fromTeamId: player.currentTeamId!,
        startTime,
        endTime,
      });

      // Remove team role
      const member = await interaction.guild?.members.fetch(user.id);
      const teamRole = interaction.guild?.roles.cache.find(
        (role: Role) => role.name === player.currentTeam?.name
      );

      if (teamRole && member) {
        await member.roles.remove(teamRole);
      }

      // Update player status
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
          { name: 'Waiver Period', value: `Ends <t:${Math.floor(endTime.getTime() / 1000)}:R>` }
        )
        .setTimestamp();

      // Send notification if channel is configured
      if (settings) {
        const notificationChannel = await interaction.guild?.channels.fetch(settings.notificationChannelId);
        if (notificationChannel?.isTextBased()) {
          await notificationChannel.send({
            content: `<@&${settings.scoutRoleId}> <@&${settings.gmRoleId}> A new player is available on waivers!`,
            embeds: [waiverEmbed],
          });
        }
      }

      await interaction.reply({
        content: `${user} has been placed on waivers. They will clear in 48 hours if unclaimed.`,
        embeds: [waiverEmbed],
      });
    },
  },
];