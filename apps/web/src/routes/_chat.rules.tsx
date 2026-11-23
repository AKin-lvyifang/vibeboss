import { createFileRoute } from "@tanstack/react-router";

import { RulesPage } from "../components/vibeboss/RulesPage";

export const Route = createFileRoute("/_chat/rules")({
  component: RulesPage,
});
