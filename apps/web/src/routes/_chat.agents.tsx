import { createFileRoute } from "@tanstack/react-router";

import { RolesRulesPage } from "../components/vibeboss/RolesRulesPage";

export const Route = createFileRoute("/_chat/agents")({
  component: RolesRulesPage,
});
