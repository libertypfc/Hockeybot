import { SlashCommandBuilder, ChannelType, PermissionFlagsBits, ChatInputCommandInteraction } from 'discord.js';
import { db } from '@db';
import { teams, players, contracts } from '@db/schema';
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
        let errors: string[] = [];

        // First, get team from database
        const team = await db.query.teams.findFirst({
          where: eq(teams.name, teamName)
        });

        if (!team) {
          return interaction.editReply(`Team "${teamName}" not found in database`);
        }

        // 1. Update all players on this team to free agents
        try {
          await db.update(players)
            .set({
              currentTeamId: null,
              status: 'free_agent'
            })
            .where(eq(players.currentTeamId, team.id));
        } catch (error) {
          errors.push('Failed to update players');
          console.error('Error updating players:', error);
        }

        // 2. Delete all contracts associated with this team
        try {
          await db.delete(contracts)
            .where(eq(contracts.teamId, team.id));
        } catch (error) {
          errors.push('Failed to delete contracts');
          console.error('Error deleting contracts:', error);
        }

        // 3. Delete Discord elements
        if (interaction.guild) {
          // Delete channels in category
          try {
            const category = await interaction.guild.channels.cache.get(team.discordCategoryId);
            if (category) {
              const channelsInCategory = interaction.guild.channels.cache.filter(
                channel => channel.parentId === category.id
              );

              await Promise.all(
                channelsInCategory.map(channel => channel.delete())
              );

              await category.delete();
            }
          } catch (error) {
            errors.push('Failed to delete some Discord channels');
            console.error('Error deleting channels:', error);
          }

          // Delete team role
          try {
            const teamRole = interaction.guild.roles.cache.find(role => role.name === teamName);
            if (teamRole) {
              await teamRole.delete();
            }
          } catch (error) {
            errors.push('Failed to delete team role');
            console.error('Error deleting role:', error);
          }
        }

        // 4. Finally, delete the team from database
        try {
          await db.delete(teams).where(eq(teams.id, team.id));
        } catch (error) {
          errors.push('Failed to delete team from database');
          console.error('Error deleting team from database:', error);
          throw error; // This is critical, so we throw
        }

        const successMessage = `Team ${teamName} has been deleted.`;
        const errorMessage = errors.length > 0 
          ? `\nWarning: Some operations failed: ${errors.join(', ')}`
          : '';

        await interaction.editReply(successMessage + errorMessage);
      } catch (error) {
        console.error('Critical error deleting team:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to delete team: ${errorMessage}`);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('clearteam')
      .setDescription('Remove a team and all its data from the database')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of the team to clear')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const teamName = interaction.options.getString('name', true);

        // Get team from database
        const team = await db.query.teams.findFirst({
          where: eq(teams.name, teamName)
        });

        if (!team) {
          return interaction.editReply(`Team "${teamName}" not found in database`);
        }

        // Update all players on this team to free agents
        await db.update(players)
          .set({
            currentTeamId: null,
            status: 'free_agent'
          })
          .where(eq(players.currentTeamId, team.id));

        // Delete all contracts associated with this team
        await db.delete(contracts)
          .where(eq(contracts.teamId, team.id));

        // Finally, delete the team
        await db.delete(teams)
          .where(eq(teams.id, team.id));

        await interaction.editReply(`Team ${teamName} has been cleared from the database. All players have been set to free agents.`);

      } catch (error) {
        console.error('Error clearing team:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        await interaction.editReply(`Failed to clear team: ${errorMessage}`);
      }
    },
  },
];