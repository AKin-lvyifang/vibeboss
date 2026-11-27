import { createFileRoute } from "@tanstack/react-router";

import { KnowledgePage } from "../components/vibeboss/KnowledgePage";

export const Route = createFileRoute("/_chat/knowledge")({
  component: KnowledgePage,
});
