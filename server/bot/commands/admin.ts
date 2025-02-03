import { SlashCommandBuilder, ChatInputCommandInteraction, ChannelType } from 'discord.js';
import { db } from '@db';
import { guildSettings } from '@db/schema';
import { eq } from 'drizzle-orm';

export const AdminCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('setwelcomechannel')
      .setDescription('Set the channel for welcome messages')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('The channel to send welcome messages in')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText))
      .setDefaultMemberPermissions('0'), // Requires admin permissions

    async execute(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();

      try {
        const channel = interaction.options.getChannel('channel', true);

        if (channel.type !== ChannelType.GuildText) {
          return interaction.editReply('Please select a text channel for welcome messages.');
        }

        // Update or insert guild settings
        await db.insert(guildSettings)
          .values({
            guildId: interaction.guildId!,
            welcomeChannelId: channel.id,
          })
          .onConflictDoUpdate({
            target: guildSettings.guildId,
            set: { welcomeChannelId: channel.id },
          });

        await interaction.editReply(`Welcome messages will now be sent to ${channel}`);
      } catch (error) {
        console.error('Error setting welcome channel:', error);
        await interaction.editReply('Failed to set welcome channel');
      }
    },
  },
];