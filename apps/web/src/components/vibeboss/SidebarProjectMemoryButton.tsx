import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { BrainIcon } from "lucide-react";
import { T, useGT, Var } from "gt-react";

import { useEnvironmentQuery } from "../../state/query";
import { vibeBossEnvironment } from "../../state/vibeboss";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Opens the project's memory tab. Faint while the project has none. The state is
 * read only once the row is hovered or focused, so a long sidebar sends no requests up front.
 */
export function SidebarProjectMemoryButton(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectName: string;
  readonly rowId: string;
  readonly active: boolean;
  readonly onOpen: () => void;
}) {
  const gt = useGT();
  const { data } = useEnvironmentQuery(
    props.active
      ? vibeBossEnvironment.memory({
          environmentId: props.environmentId,
          input: { projectId: props.projectId },
        })
      : null,
  );
  const missing = data != null && !data.exists;
  return (
    <span className={missing ? "flex opacity-50 hover:opacity-100" : "flex"}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              data-sidebar-action-for={props.rowId}
              size="icon-xs"
              variant="ghost-muted"
              aria-label={gt("Project memory of {project}", { project: props.projectName })}
              onClick={props.onOpen}
            />
          }
        >
          <BrainIcon aria-hidden />
        </TooltipTrigger>
        <TooltipPopup>
          <T>
            Project memory of <Var>{props.projectName}</Var>
          </T>
        </TooltipPopup>
      </Tooltip>
    </span>
  );
}
