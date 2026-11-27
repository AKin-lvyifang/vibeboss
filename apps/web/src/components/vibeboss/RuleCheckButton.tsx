import type { EnvironmentId, VibeBossReviewModel } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { ReviewModelFields } from "./ReviewModelFields";

/** "Check rules", with the model the check asks one click away. */
export function RuleCheckButton(props: {
  readonly environmentId: EnvironmentId;
  readonly reviewModel: VibeBossReviewModel | undefined;
  readonly checking: boolean;
  readonly disabled: boolean;
  readonly onCheck: () => void;
  readonly onReviewModelChange: (reviewModel: VibeBossReviewModel) => void;
}) {
  const gt = useGT();

  return (
    <Group>
      <Button size="sm" variant="outline" disabled={props.disabled} onClick={props.onCheck}>
        {props.checking ? <T>Checking…</T> : <T>Check rules</T>}
      </Button>
      <GroupSeparator />
      <Popover>
        <PopoverTrigger
          render={
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={gt("Model used by the rules check")}
            />
          }
        >
          <ChevronDownIcon />
        </PopoverTrigger>
        <PopoverPopup align="end" className="w-72">
          <div className="flex flex-col gap-2">
            <PopoverTitle>
              <T>Model used by the rules check</T>
            </PopoverTitle>
            <ReviewModelFields
              environmentId={props.environmentId}
              value={props.reviewModel}
              onChange={props.onReviewModelChange}
            />
          </div>
        </PopoverPopup>
      </Popover>
    </Group>
  );
}
