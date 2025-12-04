import { archestraApiSdk } from "@shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const { updateInternalMcpCatalogItem } = archestraApiSdk;

interface SavePolicyPreferenceParams {
  catalogId: string;
  preset: string;
}

/**
 * Hook for saving the policy preference to a catalog item.
 * This stores the policy configuration that will be applied
 * when tools from this server are assigned to agents.
 */
export function useSaveMcpServerPolicyPreference() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ catalogId, preset }: SavePolicyPreferenceParams) => {
      // Store the policy preference in the catalog item
      const response = await updateInternalMcpCatalogItem({
        path: { id: catalogId },
        body: {
          toolCallingPolicy: { preset, applyOnAssignment: true },
        },
      });
      return response.data;
    },
    onSuccess: () => {
      toast.success("Security policy preference saved");
      queryClient.invalidateQueries({ queryKey: ["mcp-catalog"] });
    },
    onError: () => {
      toast.error("Failed to save security policy preference");
    },
  });
}
