import { pgTable, text, serial, integer, boolean, timestamp, unique, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { relations, sql } from "drizzle-orm";

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").unique().notNull(),
  discordCategoryId: text("discord_category_id").notNull(),
  salaryCap: integer("salary_cap").default(0),
  availableCap: integer("available_cap").default(0),
});

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  discordId: text("discord_id").unique().notNull(),
  username: text("username").notNull(),
  currentTeamId: integer("current_team_id").references(() => teams.id),
  status: text("status").default("free_agent"),
  salaryExempt: boolean("salary_exempt").default(false),
});

export const contracts = pgTable("contracts", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => players.id).notNull(),
  teamId: integer("team_id").references(() => teams.id).notNull(),
  salary: integer("salary").notNull(),
  lengthInDays: integer("length_in_days").notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  status: text("status").default("pending"),
});

export const waivers = pgTable("waivers", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => players.id).notNull(),
  fromTeamId: integer("from_team_id").references(() => teams.id).notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  status: text("status").default("active"),
});

export const waiverSettings = pgTable("waiver_settings", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  notificationChannelId: text("notification_channel_id").notNull(),
  scoutRoleId: text("scout_role_id").notNull(),
  gmRoleId: text("gm_role_id").notNull(),
});

export const teamsRelations = relations(teams, ({ many }) => ({
  players: many(players),
  contracts: many(contracts),
}));

export const playersRelations = relations(players, ({ one, many }) => ({
  currentTeam: one(teams, {
    fields: [players.currentTeamId],
    references: [teams.id],
  }),
  playerStats: many(playerStats),
  goalieStats: many(goalieStats),
}));

export const contractsRelations = relations(contracts, ({ one }) => ({
  player: one(players, {
    fields: [contracts.playerId],
    references: [players.id],
  }),
  team: one(teams, {
    fields: [contracts.teamId],
    references: [teams.id],
  }),
}));

export const playerStats = pgTable("player_stats", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => players.id).notNull(),
  gameDate: timestamp("game_date").notNull(),
  hits: integer("hits").default(0),
  fow: integer("fow").default(0),
  foTaken: integer("fo_taken").default(0),
  takeaways: integer("takeaways").default(0),
  interceptions: integer("interceptions").default(0),
  giveaways: integer("giveaways").default(0),
  blockedShots: integer("blocked_shots").default(0),
  passesCompleted: integer("passes_completed").default(0),
  passesAttempted: integer("passes_attempted").default(0),
  pim: integer("pim").default(0),
  shots: integer("shots").default(0),
});

export const goalieStats = pgTable("goalie_stats", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => players.id).notNull(),
  gameDate: timestamp("game_date").notNull(),
  saves: integer("saves").default(0),
  goalsAgainst: integer("goals_against").default(0),
  breakaways: integer("breakaways").default(0),
  breakawaySaves: integer("breakaway_saves").default(0),
  desperation_saves: integer("desperation_saves").default(0),
  timeInNet: integer("time_in_net").default(0),
});

export const playerStatsRelations = relations(playerStats, ({ one }) => ({
  player: one(players, {
    fields: [playerStats.playerId],
    references: [players.id],
  }),
}));

export const goalieStatsRelations = relations(goalieStats, ({ one }) => ({
  player: one(players, {
    fields: [goalieStats.playerId],
    references: [players.id],
  }),
}));

export const insertTeamSchema = createInsertSchema(teams);
export const selectTeamSchema = createSelectSchema(teams);

export const insertPlayerSchema = createInsertSchema(players);
export const selectPlayerSchema = createSelectSchema(players);

export const insertContractSchema = createInsertSchema(contracts);
export const selectContractSchema = createSelectSchema(contracts);

export const insertWaiverSchema = createInsertSchema(waivers);
export const selectWaiverSchema = createSelectSchema(waivers);

export const insertWaiverSettingsSchema = createInsertSchema(waiverSettings);
export const selectWaiverSettingsSchema = createSelectSchema(waiverSettings);

export const insertPlayerStatsSchema = createInsertSchema(playerStats);
export const selectPlayerStatsSchema = createSelectSchema(playerStats);

export const insertGoalieStatsSchema = createInsertSchema(goalieStats);
export const selectGoalieStatsSchema = createSelectSchema(goalieStats);

export type PlayerStats = typeof playerStats.$inferSelect;
export type GoalieStats = typeof goalieStats.$inferSelect;

export type Team = typeof teams.$inferSelect;
export type Player = typeof players.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type Waiver = typeof waivers.$inferSelect;
export type WaiverSettings = typeof waiverSettings.$inferSelect;