import { SlashCommandBuilder, ChatInputCommandInteraction, Role } from 'discord.js';
import { db } from '@db';
import { players, waivers } from '@db/schema';
import { eq } from 'drizzle-orm';

export const WaiversCommands = [
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
        .set({ status: 'waivers' })
        .where(eq(players.id, player.id));

      await interaction.reply(
        `${user} has been placed on waivers. They will clear in 48 hours if unclaimed.`
      );
    },
  },
];