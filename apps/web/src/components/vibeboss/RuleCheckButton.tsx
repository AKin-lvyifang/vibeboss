import type { EnvironmentId, VibeBossReviewModel } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { ChevronDownIcon } from "lucide-react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { EffortSelect, ModelSelect, effortLevels, memberModel } from "./MemberFields";
import { ProviderSelect, useEnabledProviders } from "./VibeBossShared";

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
  const providers = useEnabledProviders();
  const fallback = useEnvironmentSettings(
    props.environmentId,
    (settings) => settings.textGenerationModelSelection,
  );
  // Unset follows the text generation model; the server runs it at low effort.
  const pick = props.reviewModel ?? {
    providerInstanceId: fallback.instanceId,
    model: fallback.model,
    effort: "",
  };
  const provider = providers.find((item) => item.instanceId === pick.providerInstanceId);
  const model = memberModel(provider, pick.model);

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
            <ProviderSelect
              value={pick.providerInstanceId}
              providers={providers}
              onChange={(providerInstanceId) =>
                props.onReviewModelChange({ providerInstanceId, model: "", effort: "" })
              }
            />
            <ModelSelect
              provider={provider}
              value={pick.model}
              onChange={(next) => {
                const keep = effortLevels(memberModel(provider, next)).some(
                  (level) => level.id === pick.effort,
                );
                props.onReviewModelChange({
                  ...pick,
                  model: next,
                  effort: keep ? pick.effort : "",
                });
              }}
            />
            <EffortSelect
              model={model}
              value={pick.effort}
              onChange={(effort) => props.onReviewModelChange({ ...pick, effort })}
            />
          </div>
        </PopoverPopup>
      </Popover>
    </Group>
  );
}
