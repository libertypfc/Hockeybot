import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlayerStatsForm } from "@/components/stats/player-stats-form";
import { GoalieStatsForm } from "@/components/stats/goalie-stats-form";
import { StatsHistory } from "@/components/stats/stats-history";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TeamStatsForm } from "@/components/stats/team-stats-form";

interface Team {
  id: number;
  name: string;
}

interface Player {
  id: number;
  username: string;
  discordId: string;
}

export default function StatsTracking() {
  const [activeTab, setActiveTab] = useState<"team" | "player" | "goalie">("team");
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const { toast } = useToast();

  const { data: teams, isLoading: teamsLoading } = useQuery<Team[]>({
    queryKey: ['/api/teams'],
  });

  const { data: players, isLoading: playersLoading } = useQuery<Player[]>({
    queryKey: ['/api/teams/players', selectedTeam],
    enabled: !!selectedTeam,
  });

  return (
    <div className="min-h-screen w-full p-8 bg-gray-50">
      <div className="max-w-6xl mx-auto space-y-8">
        <Card>
          <CardContent className="pt-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Stats Tracking</h1>

            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-2">Select Team</h2>
              <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a team" />
                </SelectTrigger>
                <SelectContent>
                  {teams?.map((team) => (
                    <SelectItem key={team.id} value={team.id.toString()}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "team" | "player" | "goalie")} className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-8">
                <TabsTrigger value="team">Team Stats</TabsTrigger>
                <TabsTrigger value="player">Player Stats</TabsTrigger>
                <TabsTrigger value="goalie">Goalie Stats</TabsTrigger>
              </TabsList>

              <TabsContent value="team">
                {selectedTeam ? (
                  <div className="space-y-4">
                    <h2 className="text-xl font-semibold">Team Statistics</h2>
                    <TeamStatsForm teamId={selectedTeam} />
                  </div>
                ) : (
                  <p className="text-gray-500">Please select a team first</p>
                )}
              </TabsContent>


              <TabsContent value="player">
                {selectedTeam ? (
                  <PlayerStatsForm players={players} isLoading={playersLoading} />
                ) : (
                  <p className="text-gray-500">Please select a team first</p>
                )}
              </TabsContent>

              <TabsContent value="goalie">
                {selectedTeam ? (
                  <GoalieStatsForm players={players} isLoading={playersLoading} />
                ) : (
                  <p className="text-gray-500">Please select a team first</p>
                )}
              </TabsContent>
            </Tabs>

            <div className="mt-8">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Stats History</h2>
              <StatsHistory type={activeTab} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}