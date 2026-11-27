import type { EnvironmentId, VibeBossReviewModel } from "@t3tools/contracts";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { EffortSelect, ModelSelect, effortLevels, memberModel } from "./MemberFields";
import { ProviderSelect, useEnabledProviders } from "./VibeBossShared";

/** Agent, model and effort of a small-model job; unset follows the text generation model. */
export function ReviewModelFields(props: {
  readonly environmentId: EnvironmentId;
  readonly value: VibeBossReviewModel | undefined;
  readonly onChange: (value: VibeBossReviewModel) => void;
}) {
  const providers = useEnabledProviders();
  const fallback = useEnvironmentSettings(
    props.environmentId,
    (settings) => settings.textGenerationModelSelection,
  );
  // Unset follows the text generation model; the server runs it at low effort.
  const pick = props.value ?? {
    providerInstanceId: fallback.instanceId,
    model: fallback.model,
    effort: "",
  };
  const provider = providers.find((item) => item.instanceId === pick.providerInstanceId);
  const model = memberModel(provider, pick.model);

  return (
    <>
      <ProviderSelect
        value={pick.providerInstanceId}
        providers={providers}
        onChange={(providerInstanceId) =>
          props.onChange({ providerInstanceId, model: "", effort: "" })
        }
      />
      <ModelSelect
        provider={provider}
        value={pick.model}
        onChange={(next) => {
          const keep = effortLevels(memberModel(provider, next)).some(
            (level) => level.id === pick.effort,
          );
          props.onChange({ ...pick, model: next, effort: keep ? pick.effort : "" });
        }}
      />
      <EffortSelect
        model={model}
        value={pick.effort}
        onChange={(effort) => props.onChange({ ...pick, effort })}
      />
    </>
  );
}
