import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";

const playerStatsSchema = z.object({
  playerId: z.string(),
  gameDate: z.date(),
  hits: z.string().transform(Number),
  fow: z.string().transform(Number),
  foTaken: z.string().transform(Number),
  takeaways: z.string().transform(Number),
  interceptions: z.string().transform(Number),
  giveaways: z.string().transform(Number),
  blockedShots: z.string().transform(Number),
  passesCompleted: z.string().transform(Number),
  passesAttempted: z.string().transform(Number),
  pim: z.string().transform(Number),
  shots: z.string().transform(Number),
});

interface PlayerStatsFormProps {
  players?: { id: number; username: string; discordId: string; }[];
  isLoading: boolean;
}

export function PlayerStatsForm({ players, isLoading }: PlayerStatsFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const form = useForm<z.infer<typeof playerStatsSchema>>({
    resolver: zodResolver(playerStatsSchema),
    defaultValues: {
      hits: "0",
      fow: "0",
      foTaken: "0",
      takeaways: "0",
      interceptions: "0",
      giveaways: "0",
      blockedShots: "0",
      passesCompleted: "0",
      passesAttempted: "0",
      pim: "0",
      shots: "0",
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof playerStatsSchema>) => {
      const response = await fetch("/api/stats/player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error("Failed to save stats");
      return response.json();
    },
    onSuccess: () => {
      toast({ description: "Player stats saved successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/stats/player'] });
      form.reset();
    },
    onError: () => {
      toast({ description: "Failed to save player stats", variant: "destructive" });
    },
  });

  function onSubmit(values: z.infer<typeof playerStatsSchema>) {
    mutation.mutate(values);
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="playerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Player</FormLabel>
                <Select onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select player" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {players?.map((player) => (
                      <SelectItem key={player.id} value={player.id.toString()}>
                        {player.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="gameDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Game Date</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button variant="outline" className="w-full pl-3 text-left font-normal">
                        {field.value ? (
                          format(field.value, "PPP")
                        ) : (
                          <span>Pick a date</span>
                        )}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={field.onChange}
                      disabled={(date) =>
                        date > new Date() || date < new Date("2024-01-01")
                      }
                    />
                  </PopoverContent>
                </Popover>
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { name: "hits", label: "Hits" },
            { name: "fow", label: "Faceoffs Won" },
            { name: "foTaken", label: "Faceoffs Taken" },
            { name: "takeaways", label: "Takeaways" },
            { name: "interceptions", label: "Interceptions" },
            { name: "giveaways", label: "Giveaways" },
            { name: "blockedShots", label: "Blocked Shots" },
            { name: "passesCompleted", label: "Passes Completed" },
            { name: "passesAttempted", label: "Passes Attempted" },
            { name: "pim", label: "PIM" },
            { name: "shots", label: "Shots" },
          ].map(({ name, label }) => (
            <FormField
              key={name}
              control={form.control}
              name={name as keyof z.infer<typeof playerStatsSchema>}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{label}</FormLabel>
                  <FormControl>
                    <Input type="number" min="0" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
          ))}
        </div>

        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving..." : "Save Stats"}
        </Button>
      </form>
    </Form>
  );
}
