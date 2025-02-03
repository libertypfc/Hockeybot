import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const teamStatsSchema = z.object({
  wins: z.number().min(0),
  losses: z.number().min(0),
  otLosses: z.number().min(0),
  goalsFor: z.number().min(0),
  goalsAgainst: z.number().min(0),
});

type TeamStatsFormValues = z.infer<typeof teamStatsSchema>;

interface TeamStatsFormProps {
  teamId: string;
}

export function TeamStatsForm({ teamId }: TeamStatsFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch current team stats
  const { data: currentStats, isLoading } = useQuery({
    queryKey: ['/api/teams/stats', teamId],
    enabled: !!teamId,
  });

  const form = useForm<TeamStatsFormValues>({
    resolver: zodResolver(teamStatsSchema),
    defaultValues: {
      wins: currentStats?.wins || 0,
      losses: currentStats?.losses || 0,
      otLosses: currentStats?.otLosses || 0,
      goalsFor: currentStats?.goalsFor || 0,
      goalsAgainst: currentStats?.goalsAgainst || 0,
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: TeamStatsFormValues) => {
      const response = await fetch(`/api/teams/stats/${teamId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error('Failed to update team stats');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/teams/stats', teamId] });
      toast({
        title: "Success",
        description: "Team statistics have been updated",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to update team statistics",
        variant: "destructive",
      });
    },
  });

  function onSubmit(values: TeamStatsFormValues) {
    mutation.mutate(values);
  }

  if (isLoading) return <div>Loading...</div>;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <FormField
            control={form.control}
            name="wins"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Wins</FormLabel>
                <FormControl>
                  <Input type="number" min="0" {...field} onChange={e => field.onChange(Number(e.target.value))} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="losses"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Losses</FormLabel>
                <FormControl>
                  <Input type="number" min="0" {...field} onChange={e => field.onChange(Number(e.target.value))} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="otLosses"
            render={({ field }) => (
              <FormItem>
                <FormLabel>OT Losses</FormLabel>
                <FormControl>
                  <Input type="number" min="0" {...field} onChange={e => field.onChange(Number(e.target.value))} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="goalsFor"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Goals For</FormLabel>
                <FormControl>
                  <Input type="number" min="0" {...field} onChange={e => field.onChange(Number(e.target.value))} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="goalsAgainst"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Goals Against</FormLabel>
                <FormControl>
                  <Input type="number" min="0" {...field} onChange={e => field.onChange(Number(e.target.value))} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Button type="submit" className="w-full">Update Team Stats</Button>
      </form>
    </Form>
  );
}
