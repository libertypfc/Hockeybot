import { SlashCommandBuilder, ChannelType, PermissionFlagsBits, ChatInputCommandInteraction } from 'discord.js';
import { db } from '@db';
import { teams } from '@db/schema';

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
      const teamName = interaction.options.getString('name', true);

      // Create category
      const category = await interaction.guild?.channels.create({
        name: teamName,
        type: ChannelType.GuildCategory,
      });

      if (!category || !interaction.guild) {
        return interaction.reply('Failed to create team category');
      }

      // Create text channels
      const channels = [
        ['team-chat', ChannelType.GuildText],
        ['signing', ChannelType.GuildText],
        ['roster', ChannelType.GuildText],
        ['stats-pictures', ChannelType.GuildText],
        ['team-voice', ChannelType.GuildVoice],
      ] as const;

      for (const [name, type] of channels) {
        await interaction.guild.channels.create({
          name,
          type,
          parent: category.id,
        });
      }

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

      await interaction.reply(`Team ${teamName} has been created with all channels and roles!`);
    },
  },
];