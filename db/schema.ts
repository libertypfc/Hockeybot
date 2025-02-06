import { pgTable, text, serial, integer, boolean, timestamp, unique, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { relations, sql } from "drizzle-orm";

// Add new tables for conferences and divisions
export const conferences = pgTable("conferences", {
  id: serial("id").primaryKey(),
  name: text("name").unique().notNull(),
  abbreviation: text("abbreviation").unique().notNull(),
  metadata: text("metadata"),
});

export const divisions = pgTable("divisions", {
  id: serial("id").primaryKey(),
  name: text("name").unique().notNull(),
  abbreviation: text("abbreviation").unique().notNull(),
  conferenceId: integer("conference_id").references(() => conferences.id).notNull(),
  metadata: text("metadata"),
});

// Update teams table to include guildId for server isolation
export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  discordCategoryId: text("discord_category_id").notNull(),
  divisionId: integer("division_id").references(() => divisions.id),
  guildId: text("guild_id").notNull(), // Add this field for server isolation
  salaryCap: integer("salary_cap").default(82500000),
  capFloor: integer("cap_floor").default(3000000),
  availableCap: integer("available_cap").default(82500000),
  metadata: text("metadata"),
});

export const teamStats = pgTable("team_stats", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").references(() => teams.id).notNull(),
  season: integer("season").notNull(),
  wins: integer("wins").default(0),
  losses: integer("losses").default(0),
  otLosses: integer("ot_losses").default(0),
  goalsFor: integer("goals_for").default(0),
  goalsAgainst: integer("goals_against").default(0),
  points: integer("points").default(0),
});

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  discordId: text("discord_id").unique().notNull(),
  username: text("username").notNull(),
  currentTeamId: integer("current_team_id").references(() => teams.id),
  status: text("status").default("free_agent"),
  salaryExempt: boolean("salary_exempt").default(false),
  welcomeMessageSent: boolean("welcome_message_sent").default(false),
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
  metadata: text("metadata"),
});

export const guildSettings = pgTable("guild_settings", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").unique().notNull(),
  welcomeChannelId: text("welcome_channel_id").notNull(),
  capNotificationChannelId: text("cap_notification_channel_id"),
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

export const seasons = pgTable("seasons", {
  id: serial("id").primaryKey(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  numberOfWeeks: integer("number_of_weeks").notNull(),
  status: text("status").default("pending"), // pending, active, completed
  metadata: text("metadata"),
});

export const gameSchedule = pgTable("game_schedule", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").references(() => seasons.id).notNull(),
  homeTeamId: integer("home_team_id").references(() => teams.id).notNull(),
  awayTeamId: integer("away_team_id").references(() => teams.id).notNull(),
  gameDate: timestamp("game_date").notNull(),
  gameNumber: integer("game_number").notNull(), // 1 or 2 for same-night games
  status: text("status").default("scheduled"), // scheduled, completed, cancelled
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  metadata: text("metadata"),
});

export const tradeAdminSettings = pgTable("trade_admin_settings", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").unique().notNull(),
  adminChannelId: text("admin_channel_id").notNull(),
});

export const tradeProposals = pgTable("trade_proposals", {
  id: serial("id").primaryKey(),
  fromTeamId: integer("from_team_id").references(() => teams.id).notNull(),
  toTeamId: integer("to_team_id").references(() => teams.id).notNull(),
  playerId: integer("player_id").references(() => players.id).notNull(),
  status: text("status").default("pending"), // pending, accepted, rejected, admin_approved, admin_rejected
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  messageId: text("message_id"), // Discord message ID for reference
  adminMessageId: text("admin_message_id"), // Admin channel message ID
});

export const achievements = pgTable("achievements", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  type: text("type").notNull(), // 'uptime', 'commands', etc.
  requirement: integer("requirement").notNull(), // e.g., hours for uptime
  icon: text("icon").notNull(), // Icon/emoji representation
  color: text("color").notNull(), // Color hex code for the badge
  createdAt: timestamp("created_at").defaultNow(),
});

export const botUptimeAchievements = pgTable("bot_uptime_achievements", {
  id: serial("id").primaryKey(),
  achievementId: integer("achievement_id").references(() => achievements.id).notNull(),
  earnedAt: timestamp("earned_at").defaultNow(),
  uptimeHours: integer("uptime_hours").notNull(),
  metadata: text("metadata"), // Additional achievement-specific data
});


export const teamsRelations = relations(teams, ({ many, one }) => ({
  players: many(players),
  contracts: many(contracts),
  teamStats: many(teamStats),
  division: one(divisions, {
    fields: [teams.divisionId],
    references: [divisions.id],
  }),
}));

export const teamStatsRelations = relations(teamStats, ({ one }) => ({
  team: one(teams, {
    fields: [teamStats.teamId],
    references: [teams.id],
  }),
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

export const gameScheduleRelations = relations(gameSchedule, ({ one }) => ({
  season: one(seasons, {
    fields: [gameSchedule.seasonId],
    references: [seasons.id],
  }),
  homeTeam: one(teams, {
    fields: [gameSchedule.homeTeamId],
    references: [teams.id],
  }),
  awayTeam: one(teams, {
    fields: [gameSchedule.awayTeamId],
    references: [teams.id],
  }),
}));

export const tradeProposalsRelations = relations(tradeProposals, ({ one }) => ({
  fromTeam: one(teams, {
    fields: [tradeProposals.fromTeamId],
    references: [teams.id],
  }),
  toTeam: one(teams, {
    fields: [tradeProposals.toTeamId],
    references: [teams.id],
  }),
  player: one(players, {
    fields: [tradeProposals.playerId],
    references: [players.id],
  }),
}));

export const achievementsRelations = relations(achievements, ({ many }) => ({
  botUptimeAchievements: many(botUptimeAchievements),
}));

export const botUptimeAchievementsRelations = relations(botUptimeAchievements, ({ one }) => ({
  achievement: one(achievements, {
    fields: [botUptimeAchievements.achievementId],
    references: [achievements.id],
  }),
}));

export const conferencesRelations = relations(conferences, ({ many }) => ({
  divisions: many(divisions),
}));

export const divisionsRelations = relations(divisions, ({ one, many }) => ({
  conference: one(conferences, {
    fields: [divisions.conferenceId],
    references: [conferences.id],
  }),
  teams: many(teams),
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

export const insertGuildSettingsSchema = createInsertSchema(guildSettings);
export const selectGuildSettingsSchema = createSelectSchema(guildSettings);

export const insertTeamStatsSchema = createInsertSchema(teamStats);
export const selectTeamStatsSchema = createSelectSchema(teamStats);

export const insertSeasonSchema = createInsertSchema(seasons);
export const selectSeasonSchema = createSelectSchema(seasons);

export const insertGameScheduleSchema = createInsertSchema(gameSchedule);
export const selectGameScheduleSchema = createSelectSchema(gameSchedule);

export const insertTradeAdminSettingsSchema = createInsertSchema(tradeAdminSettings);
export const selectTradeAdminSettingsSchema = createSelectSchema(tradeAdminSettings);

export const insertTradeProposalSchema = createInsertSchema(tradeProposals);
export const selectTradeProposalSchema = createSelectSchema(tradeProposals);

export const insertAchievementSchema = createInsertSchema(achievements);
export const selectAchievementSchema = createSelectSchema(achievements);

export const insertBotUptimeAchievementSchema = createInsertSchema(botUptimeAchievements);
export const selectBotUptimeAchievementSchema = createSelectSchema(botUptimeAchievements);

export const insertConferenceSchema = createInsertSchema(conferences);
export const selectConferenceSchema = createSelectSchema(conferences);

export const insertDivisionSchema = createInsertSchema(divisions);
export const selectDivisionSchema = createSelectSchema(divisions);

export type PlayerStats = typeof playerStats.$inferSelect;
export type GoalieStats = typeof goalieStats.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Player = typeof players.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type Waiver = typeof waivers.$inferSelect;
export type WaiverSettings = typeof waiverSettings.$inferSelect;
export type GuildSettings = typeof guildSettings.$inferSelect;
export type TeamStats = typeof teamStats.$inferSelect;
export type Season = typeof seasons.$inferSelect;
export type GameSchedule = typeof gameSchedule.$inferSelect;
export type TradeAdminSettings = typeof tradeAdminSettings.$inferSelect;
export type TradeProposal = typeof tradeProposals.$inferSelect;
export type Achievement = typeof achievements.$inferSelect;
export type BotUptimeAchievement = typeof botUptimeAchievements.$inferSelect;
export type Conference = typeof conferences.$inferSelect;
export type Division = typeof divisions.$inferSelect;