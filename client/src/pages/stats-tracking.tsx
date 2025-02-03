import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlayerStatsForm } from "@/components/stats/player-stats-form";
import { GoalieStatsForm } from "@/components/stats/goalie-stats-form";
import { StatsHistory } from "@/components/stats/stats-history";
import { useToast } from "@/hooks/use-toast";

export default function StatsTracking() {
  const [activeTab, setActiveTab] = useState("player");
  const { toast } = useToast();

  const { data: players, isLoading: playersLoading } = useQuery<{
    id: number;
    username: string;
    discordId: string;
  }[]>({
    queryKey: ['/api/players'],
  });

  return (
    <div className="min-h-screen w-full p-8 bg-gray-50">
      <div className="max-w-6xl mx-auto space-y-8">
        <Card>
          <CardContent className="pt-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Stats Tracking</h1>
            
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-8">
                <TabsTrigger value="player">Player Stats</TabsTrigger>
                <TabsTrigger value="goalie">Goalie Stats</TabsTrigger>
              </TabsList>

              <TabsContent value="player">
                <PlayerStatsForm players={players} isLoading={playersLoading} />
              </TabsContent>

              <TabsContent value="goalie">
                <GoalieStatsForm players={players} isLoading={playersLoading} />
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
