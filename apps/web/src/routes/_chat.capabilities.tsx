import { createFileRoute } from "@tanstack/react-router";

import { CapabilitiesPage } from "../components/vibeboss/CapabilitiesPage";

export const Route = createFileRoute("/_chat/capabilities")({
  component: CapabilitiesPage,
});
