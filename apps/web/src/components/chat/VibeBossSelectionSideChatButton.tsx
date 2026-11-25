import { useGT } from "gt-react";
import { MessagesSquareIcon } from "lucide-react";
import { Button } from "../ui/button";

/** Sits beside "Cite" in the selection toolbar; opens a side chat with the selection cited. */
export function VibeBossSelectionSideChatButton({ onClick }: { onClick: () => void }) {
  const gt = useGT();
  return (
    <Button
      type="button"
      size="xs"
      variant="glass"
      aria-label={gt("Cite selection in a new side chat")}
      onClick={onClick}
    >
      <MessagesSquareIcon aria-hidden="true" className="size-3.5" />
      {gt("Side chat")}
    </Button>
  );
}
