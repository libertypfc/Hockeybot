import { pgTable, text, serial, integer, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";

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

export const playersRelations = relations(players, ({ one }) => ({
  currentTeam: one(teams, {
    fields: [players.currentTeamId],
    references: [teams.id],
  }),
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


export type Team = typeof teams.$inferSelect;
export type Player = typeof players.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type Waiver = typeof waivers.$inferSelect;
export type WaiverSettings = typeof waiverSettings.$inferSelect;