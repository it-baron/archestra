"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PolicyConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mcpServerName: string;
  onAccept: () => void;
  onSkip: () => void;
  isLoading?: boolean;
}

export function PolicyConfigDialog({
  open,
  onOpenChange,
  mcpServerName,
  onAccept,
  onSkip,
  isLoading,
}: PolicyConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Configure Security Policies
          </DialogTitle>
          <DialogDescription>
            {mcpServerName} works by chaining multiple tool calls (navigate,
            screenshot, click, type, etc.)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            By default, Archestra blocks tool chains when external data is
            present in context. We can pre-configure policies for you to enable
            chaining while maintaining security:
          </p>
          <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
            <li>Allow browser tools to chain within a session</li>
            <li>Block access to internal networks (SSRF protection)</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            These policies will be applied automatically when you assign these
            tools to an agent.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onSkip} disabled={isLoading}>
            Skip
          </Button>
          <Button onClick={onAccept} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving Preference...
              </>
            ) : (
              "Save & Continue"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
