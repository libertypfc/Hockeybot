import { SlashCommandBuilder, ChannelType, PermissionFlagsBits, ChatInputCommandInteraction } from 'discord.js';
import { db } from '@db';
import { teams } from '@db/schema';
import { eq } from 'drizzle-orm';

export const TeamCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('createteam')
      .setDescription('Creates a new team with all required channels')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of the team')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction: ChatInputCommandInteraction) {
      // Defer the reply immediately to prevent timeout
      await interaction.deferReply();

      try {
        const teamName = interaction.options.getString('name', true);

        // Create category
        const category = await interaction.guild?.channels.create({
          name: teamName,
          type: ChannelType.GuildCategory,
        });

        if (!category || !interaction.guild) {
          return interaction.editReply('Failed to create team category');
        }

        // Create text and voice channels
        const channels = [
          ['team-chat', ChannelType.GuildText],
          ['signing', ChannelType.GuildText],
          ['roster', ChannelType.GuildText],
          ['team-voice', ChannelType.GuildVoice],
        ] as const;

        // Create all standard channels in parallel
        await Promise.all(channels.map(([name, type]) => 
          interaction.guild!.channels.create({
            name,
            type,
            parent: category.id,
          })
        ));

        // Create media channel with specific settings
        await interaction.guild.channels.create({
          name: 'stats-pictures',
          type: ChannelType.GuildMedia,
          parent: category.id,
          rateLimitPerUser: 30, // 30 seconds slowmode to prevent spam
          nsfw: false,
          permissionOverwrites: [
            {
              id: interaction.guild.roles.everyone.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
              ],
              deny: [
                PermissionFlagsBits.CreatePublicThreads,
                PermissionFlagsBits.CreatePrivateThreads,
              ]
            }
          ]
        });

        // Create team role
        const role = await interaction.guild.roles.create({
          name: teamName,
          mentionable: true,
        });

        // Save team to database
        await db.insert(teams).values({
          name: teamName,
          discordCategoryId: category.id,
          salaryCap: 82_500_000, // NHL salary cap as default
          availableCap: 82_500_000,
        });

        await interaction.editReply(`Team ${teamName} has been created successfully with all channels and roles!`);
      } catch (error) {
        console.error('Error creating team:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to create team: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('deleteteam')
      .setDescription('Deletes a team and all associated channels/roles')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of the team to delete')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const teamName = interaction.options.getString('name', true);

        // Get team from database
        const team = await db.query.teams.findFirst({
          where: eq(teams.name, teamName)
        });

        if (!team) {
          return interaction.editReply(`Team "${teamName}" not found`);
        }

        // Delete channels in category
        const category = await interaction.guild?.channels.cache.get(team.discordCategoryId);
        if (category) {
          // Delete all channels in the category
          const channelsInCategory = interaction.guild?.channels.cache.filter(
            channel => channel.parentId === category.id
          );

          await Promise.all(
            channelsInCategory?.map(channel => channel.delete()) || []
          );

          // Delete the category itself
          await category.delete();
        }

        // Delete team role
        const teamRole = interaction.guild?.roles.cache.find(role => role.name === teamName);
        if (teamRole) {
          await teamRole.delete();
        }

        // Delete from database
        await db.delete(teams).where(eq(teams.name, teamName));

        await interaction.editReply(`Team ${teamName} has been successfully deleted with all associated channels and roles.`);
      } catch (error) {
        console.error('Error deleting team:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to delete team: ${errorMessage}`);
      }
    },
  },
];