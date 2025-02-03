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

const goalieStatsSchema = z.object({
  playerId: z.string(),
  gameDate: z.date(),
  saves: z.string().transform(Number),
  goalsAgainst: z.string().transform(Number),
  breakaways: z.string().transform(Number),
  breakawaySaves: z.string().transform(Number),
  desperationSaves: z.string().transform(Number),
  timeInNet: z.string().transform(Number),
});

interface GoalieStatsFormProps {
  players?: { id: number; username: string; discordId: string; }[];
  isLoading: boolean;
}

export function GoalieStatsForm({ players, isLoading }: GoalieStatsFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const form = useForm<z.infer<typeof goalieStatsSchema>>({
    resolver: zodResolver(goalieStatsSchema),
    defaultValues: {
      saves: "0",
      goalsAgainst: "0",
      breakaways: "0",
      breakawaySaves: "0",
      desperationSaves: "0",
      timeInNet: "0",
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof goalieStatsSchema>) => {
      const response = await fetch("/api/stats/goalie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error("Failed to save stats");
      return response.json();
    },
    onSuccess: () => {
      toast({ description: "Goalie stats saved successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/stats/goalie'] });
      form.reset();
    },
    onError: () => {
      toast({ description: "Failed to save goalie stats", variant: "destructive" });
    },
  });

  function onSubmit(values: z.infer<typeof goalieStatsSchema>) {
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
                <FormLabel>Goalie</FormLabel>
                <Select onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select goalie" />
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

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { name: "saves", label: "Saves" },
            { name: "goalsAgainst", label: "Goals Against" },
            { name: "breakaways", label: "Breakaways" },
            { name: "breakawaySaves", label: "Breakaway Saves" },
            { name: "desperationSaves", label: "Desperation Saves" },
            { name: "timeInNet", label: "Time in Net (seconds)" },
          ].map(({ name, label }) => (
            <FormField
              key={name}
              control={form.control}
              name={name as keyof z.infer<typeof goalieStatsSchema>}
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
