import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Button } from "./button";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "./skeleton";

interface Player {
  id: number;
  username: string;
  discordId: string;
  salaryExempt: boolean;
  salary: number;
}

interface Team {
  id: number;
  name: string;
}

export function ExemptionManager() {
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: teams, isLoading: teamsLoading } = useQuery<Team[]>({
    queryKey: ['/api/teams'],
  });

  const { data: roster, isLoading: rosterLoading } = useQuery<Player[]>({
    queryKey: ['/api/teams', selectedTeamId, 'roster'],
    enabled: selectedTeamId !== "",
  });

  const toggleExemption = useMutation({
    mutationFn: async (playerId: number) => {
      if (!selectedTeamId) throw new Error("No team selected");
      await apiRequest('POST', `/api/teams/${parseInt(selectedTeamId)}/exempt/${playerId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/teams', selectedTeamId, 'roster'] });
      queryClient.invalidateQueries({ queryKey: ['/api/teams'] });
      toast({
        title: "Success",
        description: "Player exemption status updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update exemption status",
        variant: "destructive",
      });
    },
  });

  const handleTeamSelect = (value: string) => {
    setSelectedTeamId(value);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage Salary Exemptions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Team</label>
          <Select
            value={selectedTeamId}
            onValueChange={handleTeamSelect}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a team" />
            </SelectTrigger>
            <SelectContent>
              {teamsLoading ? (
                <SelectItem value="loading" disabled>Loading teams...</SelectItem>
              ) : teams?.map((team) => (
                <SelectItem key={team.id} value={team.id.toString()}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedTeamId && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Team Roster</label>
            {rosterLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : roster && roster.length > 0 ? (
              <div className="grid gap-2">
                {roster.map((player) => (
                  <div
                    key={player.id}
                    className="flex items-center justify-between p-2 rounded border"
                  >
                    <div>
                      <span className="font-medium">{player.username}</span>
                      <span className="ml-2 text-sm text-gray-500">
                        ${player.salary.toLocaleString()}
                      </span>
                    </div>
                    <Button
                      variant={player.salaryExempt ? "destructive" : "secondary"}
                      onClick={() => toggleExemption.mutate(player.id)}
                      disabled={toggleExemption.isPending}
                    >
                      {player.salaryExempt ? "Remove Exemption" : "Make Exempt"}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No players found in the roster.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}